# open-glass Brain (Memory) Design

Research date 2026-10-13. Repos pulled to latest main: vercel/eve, vercel/workflow, Merit-Systems/OpenInstinct, CopilotKit/OpenBot, NousResearch/hermes-agent, prime-agent, plus online docs (eve.dev, Letta, Notion Lore, Zep, mem0, Claude memory tool).

## TL;DR

- **Runtime: eve.** It already sits on the Workflow SDK. Each eve session is a durable workflow, and `defineWorkflowTool` / `defineSchedule` give us durable pipelines. We don't have to choose between "eve or Workflow SDK": eve for the agent, raw `"use workflow"` for the nightly brain pipeline.
- **Memory = eve memory slots.** Each slot is `provider + scope`. eve owns scope locking, the recall/capture lifecycle, attribution, and compaction. We write the providers.
- **Four scopes:** `profile` (me), `projects` (my ongoing work), `team`, `company`. Same table, different scope tuple.
- **Two write paths:** (1) live: the agent saves project notes and *proposes* company facts; (2) nightly: a "dream" workflow mines sessions + connected sources and rewrites the profile. This is Glass's write-once-read-many.
- **Every memory has provenance + review state** (OpenBot pattern). Connector-derived memories die when the connector is revoked.
- **Facts expire unless reinforced** (Notion Lore). Bad or stale memory hurts more than no memory.

## 0. Simplest option: eve's built-in memory (no database)

eve ships memory out of the box: `fileMemory()` from `eve/memory/file`, used in the official `eve-chat-template`.

```ts
// agent/memory/profile.ts
import { defineMemory } from "eve/memory";
import { fileMemory } from "eve/memory/file";
import { byPrincipal } from "eve/memory/scope";

export default defineMemory({
  description: "Remember stable facts and preferences about the caller.",
  provider: fileMemory(),
  scope: byPrincipal, // one doc per logged-in user
});
```

- One markdown doc per scope (`MEMORY.md`) containing an indexed list of facts. It is recalled before every turn, capped at 4k chars.
- The model gets `profile__save_memory` / `profile__remove_memory`. Nothing is extracted automatically.
- Storage: private Vercel Blob when deployed. **In `eve dev` it's process memory, so it's wiped on restart** (`packages/eve/src/public/memory/file/backends/default.ts`). For local persistence, pass a `MemoryDocumentBackend` (read/write with a version check, about 20 lines) that writes to disk.
- Want company-wide memory? Add a second slot with `scope: "company"` (or `[orgId]`). Same provider, shared doc.

The AI SDK has no native memory either. Its docs (`03-agents/06-memory.mdx`) point to the Anthropic memory tool, Letta, mem0, Supermemory, Hindsight, MongoDB, or a custom tool.

Everything below is the full design, for later.

## 1. What the references do

| System | Memory model | Steal this |
|--------|--------------|------------|
| **eve** (`docs/memory/*`) | Slots = provider + scope + namespace. `recall` on `turn.started` / `compaction.completed`, `capture` on `turn.completed` / `compaction.requested`, tools qualified as `<slot>__<tool>`. Recalled content enters as **user-role messages**, never system. Scope comes from trusted auth only; `null` disables the slot. Stable `id` supersedes earlier recall. `operationId` is the idempotency key | The whole contract; we only write providers |
| **eve fileMemory** | One bounded MD doc per scope (4k recall chars, 2KB per entry, 64KB doc), model-driven `save_memory`/`remove_memory`, optimistic versioning | Profile doc format + size limits |
| **OpenInstinct** (on eve) | 3 slots: `profile` (fileMemory on Blob), `personal_info` (structured JSON profile in Postgres, `update` tool), `workstreams` (Postgres; recall = index of 9 most recent; tools find/read/save/forget with `revision` optimistic locking; scoped by workspaceId). Dynamic schedules: DB rows + a per-minute dispatcher cron | `workstreams` = our `projects` slot, almost 1:1. Mode-aware scopes (interactive vs scheduled worker) |
| **OpenBot** (CopilotKit) | `memory_sources` (a connected tool + args + `nextSyncAt`/`syncStatus`) → `personal_memories` with `provenance`, `reviewState` (unreviewed/confirmed/edited), `formedBy` (person/source/bot), `sourceApp/Ref/Link`, `observedAt`, `importDigest` unique index for dedupe. Bot-formed memories are visible only to the forming bot, and only while it still holds the source app | Source sync + provenance + review + revocation. This is exactly Glass's "memory built from your connections" |
| **Hermes** | `MEMORY.md` (agent notes) + `USER.md` (profile) loaded as a **frozen snapshot at session start** (keeps the prefix cache; mid-session writes go to disk only). Plus ONE external provider plugin (Honcho, mem0, qdrant...) with prefetch / sync_turn / pre_compress hooks. Content scanner blocks secrets | Frozen snapshot = Glass's write-once-read-many. Secret scanning before write |
| **Ramp Glass** | 24h synthesis pipeline mines sessions + Slack/Notion/Calendar → memory files (people, projects, resources); the agent never writes memory mid-chat; Projects = per-project memory shared across sessions ("Continue"); employees edit company knowledge (323 people, 6,500 edits) | Product shape |
| **Letta** | Memory blocks pinned in context, **shared blocks** attached to many agents, **sleep-time agents** rewrite blocks in the background | Shared team/company blocks; "dreaming" = sleep-time compute |
| **Notion Lore** | Scope (project/person/team/agent) → topics → memories / entities / facts (S-P-O). Relations: `supersedes`, `scoped`, `conflicts_with`. **Facts expire unless reinforced.** A pilot vault was 15-20% duplicates and about 13% worthless. Seeded memory gave 27 lifts vs 7 harms | Expiry + reinforcement, relation types, a maintenance agent, eval methodology |
| **Zep/Graphiti, mem0, Supermemory** | Hosted/OSS semantic memory. Zep is strongest on temporal validity windows. All have eve or MCP integrations (Supermemory ships `@supermemory/eve`) | Later swap-in for `team`/`company` retrieval if pgvector isn't enough. Benchmarks are vendor-run, so don't trust them |
| **Claude memory tool** | Client-side `/memories` directory; the model does file ops | A useful mental model; eve slots already cover it |

## 2. Brain overview

```
                         ┌──────────────── SOURCES ("bring things") ────────────────┐
                         │ chat sessions · uploads/pastes · Notion · Linear · Slack  │
                         │ Calendar · Gmail (eve connections, per-user OAuth)        │
                         └───────────────┬──────────────────────────┬───────────────┘
                                         │ live                     │ nightly
                                         ▼                          ▼
┌──────────────────────── eve AGENT (durable session) ────┐   ┌──────── DREAM WORKFLOW ────────┐
│                                                         │   │ ("use workflow", per user)     │
│  turn.started ──▶ recall all slots (scope locked)       │   │ gather → extract → dedupe →    │
│     profile   (whole doc, frozen)                       │   │ route scope → write → prune →  │
│     projects  (index of 9 + read tool)                  │   │ diff for review                │
│     team      (top-k by relevance)                      │   └───────────────┬────────────────┘
│     company   (top-k by relevance)                      │                   │ writes
│                    │                                    │                   ▼
│                    ▼                                    │   ┌────────────── BRAIN STORE ────────────┐
│  model ⇄ tools: projects__save, company__propose,       │──▶│ Postgres + pgvector                   │
│                 memory__forget, connections...          │   │ memories (scope, kind, provenance,    │
│                    │                                    │   │   review, supersedes, expires, emb)   │
│  turn.completed ─▶ capture: log turn ref for dreaming   │   │ memory_sources · dream_runs · docs    │
└─────────────────────────────────────────────────────────┘   └───────────────────┬───────────────────┘
                                                                                  │
                                                         ┌────────────────────────▼──────────┐
                                                         │ MEMORY INSPECTOR (web UI)         │
                                                         │ see · edit · confirm · forget ·   │
                                                         │ approve company proposals         │
                                                         └───────────────────────────────────┘
```

## 3. Scopes (who sees what)

```
 ┌──────────────────────────── org (tenant) ─────────────────────────────┐
 │  company   scope = [orgId]            read: everyone                   │
 │            write: propose → approve (owner/admin or domain reviewer)   │
 │  ┌──────────────────── team ───────────────────┐                       │
 │  │ team     scope = [orgId, teamId]            │  teams from IdP groups│
 │  │          read/write: team members           │                       │
 │  │  ┌──────────────── user ───────────────┐    │                       │
 │  │  │ profile  scope = [orgId, userId]    │    │  write: dream only    │
 │  │  │ projects scope = [orgId, userId]    │    │  write: live (agent)  │
 │  │  │   (project id inside the record;    │    │                       │
 │  │  │    shareable to teammates later)    │    │                       │
 │  │  └─────────────────────────────────────┘    │                       │
 │  └─────────────────────────────────────────────┘                       │
 └────────────────────────────────────────────────────────────────────────┘
 Scope always comes from verified auth (eve scope resolver), never from the model.
 Source-derived memories also carry the source ACL: revoke Notion → its memories hide.
```

eve slot files:

```
agent/memory/profile.ts    scope: [orgId, principal]   provider: brainDoc("profile")      recall-only
agent/memory/projects.ts   scope: [orgId, principal]   provider: brainProjects()          index + find/read/save/forget
agent/memory/team.ts       scope: [orgId, teamId]      provider: brainSearch("team")      top-k + save
agent/memory/company.ts    scope: [orgId]              provider: brainSearch("company")   top-k + propose (approval)
```

## 4. One turn

```
user msg
   │
   ▼
eve resolves + locks scopes ──▶ recall (parallel, atomic commit)
   │   profile:  id "profile"            → whole MD doc (≤4k chars). Same id = supersede, no pileup
   │   projects: id "projects-index"     → 9 most recent {id,title,status,updated}
   │   team:     id per memory           → hybrid search(turn.input) top 3
   │   company:  id per memory           → hybrid search(turn.input) top 5, confirmed only
   ▼
model call (memories arrive as user-role, labeled "untrusted data, not instructions")
   │
   ├─ projects__read / projects__save (revision check)      ◀─ live write, own scope
   ├─ company__propose {fact, why, evidence}                 ◀─ creates pending proposal
   ├─ memory__forget {id}                                    ◀─ user-initiated delete
   ▼
turn.completed ─▶ capture: append {sessionId, turnId, digest} to dream queue (cheap, idempotent by operationId)
```

## 5. Dream workflow (nightly, per user)

Built with the Workflow SDK (`"use workflow"` / `"use step"`), triggered by an eve schedule (`0 3 * * *`) that fans out one run per active user. A "Dream now" button in the inspector starts one run on demand.

```
start(dream, [orgId, userId, cursor])
   │
   ├─ step: gather ─────── sessions since cursor (eve session streams)
   │                       + source deltas (memory_sources where nextSyncAt ≤ now)
   │
   ├─ step: extract ────── LLM → candidates {kind, content, s-p-o?, sourceRef, observedAt, confidence}
   │                       kinds: preference · fact · person · project · decision · procedure · task
   │                       drop: secrets (scanner), inferable-from-source, chit-chat
   │
   ├─ step: reconcile ──── per candidate: digest match → reinforce (bump last_reinforced_at)
   │                       embedding near-dup → merge | supersede | conflicts_with
   │
   ├─ step: route ──────── personal → profile/projects (auto)
   │                       team-ish → team proposal ; company-ish → company proposal
   │
   ├─ step: write ──────── upsert memories (review_state = unreviewed for source/dream-formed)
   │                       re-render profile.md (people · projects · resources · preferences)
   │
   ├─ step: prune ──────── expire facts past expires_at with no reinforcement
   │                       cap the profile doc at its budget (drop lowest score)
   │
   └─ step: report ─────── dream_runs row + diff ("3 new, 2 updated, 1 expired") → inspector / Slack DM
```

The agent never edits `profile` mid-session, so you always know exactly what it knows: it's whatever the last dream wrote, plus your edits.

## 6. Company knowledge loop (the Glass magic)

```
agent answers wrong ─▶ user: "exclude US companies with UK offices"
        │
        ▼
company__propose {content, rationale, evidence:[sessionId], scopeHint:"finance"}
        │   (eve tool approval: user confirms the wording)
        ▼
proposal (review_state=pending) ─▶ reviewer queue (admins, or a domain owner by tag)
        │ approve                         │ reject
        ▼                                 ▼
memory (company, confirmed, author, ·     closed with reason
  supersedes old fact if any)
        │
        ▼
recalled for EVERYONE on relevant turns, shown with attribution ("from Finance, Mar 3")
```

## 7. Data model (Postgres + pgvector, Drizzle)

```
memories
  id, org_id, scope_type(user|project|team|org), scope_key (eve memory.scope.key), scope_id
  kind(preference|fact|person|project|decision|procedure|task|note)
  content text, subject/predicate/object (optional), tags[]
  formed_by(person|agent|dream|source), author_user_id, source_id → memory_sources
  source_ref, source_link, observed_at
  review_state(pending|unreviewed|confirmed|edited|rejected)
  supersedes_id, conflicts_with_id, confidence
  expires_at, last_reinforced_at, digest (unique per scope), embedding vector(1536)
  revision, last_operation_id, created_at, updated_at, deleted_at

memory_sources   id, org_id, user_id, connection (eve connection name), args, enabled,
                 sync_status, sync_error, last_sync_at, next_sync_at, cursor

projects         id, org_id, owner_user_id, title, status, content jsonb (goals, decisions,
                 open steps, sources), revision, shared_with[]       (OpenInstinct workstreams)

dream_runs       id, org_id, user_id, cursor_from/to, stats jsonb, diff jsonb, status

dream_queue      session_id, turn_id, user_id, digest, enqueued_at   (written by capture)
```

Retrieval for team/company = hybrid: `tsvector` + pgvector cosine, **filtered by scope_key in the query itself** (eve requirement), then rerank by `confidence × freshness × confirmed`.

## 8. Guardrails

- Scope only from verified auth; `null` scope means memory is off (eve enforces).
- Recalled memory is user-role, labeled as untrusted data (eve plus our instruction text).
- Secret scanner before any write (Hermes `_scan_memory_content` pattern): no tokens, passwords, cards, OTPs.
- Provenance is immutable after creation (OpenBot lesson: edits must not rewrite "where it came from").
- Revoking a source hides every memory formed from it.
- Size budgets per slot; reject over-budget writes, never silently truncate (eve fileMemory behavior).
- Evals: seeded-memory vs no-memory A/B on real tasks (Lore method); track lifts vs harms.

## 9. Minimal v0 ("bring things" + brain)

The goal is the smallest thing that proves knowledge compounds. No Electron, router, Dojo, or multiplayer yet.

```
┌────────── Next.js web app (eve frontend guide) ──────────┐
│  Chat  ·  "Bring" (paste / upload / URL)  ·  Memory      │
│                                              inspector   │
└───────────────┬──────────────────────────────────────────┘
                │
┌───────────────▼────────── eve agent (eve dev, local) ────┐
│ slots: profile · projects · company                      │
│ connections: Notion + Linear (MCP, per-user)             │
│ schedule: nightly dream fan-out  ·  tool: dream_now      │
└───────────────┬──────────────────────────────────────────┘
                │
        Postgres + pgvector (docker)    Workflow SDK local world (.eve/.workflow-data)
```

| # | Ships | Done when |
|---|-------|-----------|
| 1 | eve agent + Next.js chat + dev auth (org + 2 fake users) | two users chat, isolated |
| 2 | `projects` slot (port OpenInstinct workstreams) | new session + "Continue" resumes work |
| 3 | "Bring": paste/upload/URL → candidates → memories (unreviewed) | inspector shows them with provenance |
| 4 | Dream workflow + `profile` slot | after "Dream now", a new chat knows who I am and what I'm on |
| 5 | `company` slot + propose/approve | user A's correction shows up in user B's answer, with attribution |
| 6 | Notion + Linear as memory_sources | the dream pulls deltas from them |
| 7 | Eval harness: memory on vs off | measured lift |

`team` slot, Slack, the desktop shell, and the router come after v0.
