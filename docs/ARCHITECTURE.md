# Architecture

How the parts fit, how a request flows, and where the code lives. The reasons behind each
choice are in [DECISIONS.md](DECISIONS.md) (referenced as D1, D2, ...).

✅ = working today, 🔨 = being built, 📋 = planned.

## The big picture

One server per company runs one eve agent. Every surface (Slack, web, Claude Code) talks to
that server, and every person's request runs as that person.

```
  Surfaces                     Server (one per company, eve)                    Storage
 ─────────────                ───────────────────────────────────────────     ──────────────
  terminal UI  ✅  ─┐         ┌──────────────────────────────────────────┐     ┌────────────┐
  web chat     📋  ─┤  auth   │ channel: who is calling, which chat      │     │ Postgres   │
  Slack/Teams  📋  ─┼───────▶ │ (membership check, speaker tags)  ✅     │────▶│ users,     │
  Claude Code  📋  ─┤         ├──────────────────────────────────────────┤     │ chats,     │
  meeting bot  📋  ─┘         │ main agent                         ✅     │     │ knowledge, │
                              │  memory recall: profile/team/company ✅   │     │ agents,    │
                              │  tools: composio ✅, knowledge search 🔨  │     │ schedules  │
                              │  policy on every tool call         ✅     │     └────────────┘
                              │  subagents + workflow fan-out      🔨     │     ┌────────────┐
                              │  user-defined agents (worker)      📋     │────▶│ git brain  │
                              ├──────────────────────────────────────────┤     │ (Markdown) │
                              │ sandbox /workspace/knowledge       🔨     │     └────────────┘
                              │ schedules: dispatcher every minute 📋     │     ┌────────────┐
                              └───────────────┬──────────────────────────┘────▶│ AI Gateway │
                                              │                                │ (models)   │
                                     Composio (500+ apps, as the user) ✅      └────────────┘
```

## How a request flows

"What did we decide about deploy freezes?" from the member:

```
 1. channel      authenticates member, checks they are in this chat, tags the message
 2. memory       recalls relevant profile, team and company entries (as data)
 3. knowledge    session start: member's visible documents → /workspace/knowledge   (D14)
 4. main agent   grep "deploy freeze" → read 2 files → answer, citing both files
 5. policy       any write or send in between is classified and approved or denied  (D19)
 6. reply        streamed to the surface; edits and approvals feed memory later
```

For a bigger ask ("prep me for tomorrow's three customer calls"), step 4 becomes a dynamic
workflow: the main agent writes a short program that runs one researcher per customer in
parallel and merges the results (D10).

## Agents

```
                       ┌──────────────────────┐
                       │ main agent (root)    │  handles any task (D9)
                       └──┬────────┬───────┬──┘
           built-in agent │        │       │ workflow tool: fan out to N subagents (D10)
           (copies, same  │        │       │
            sandbox)      ▼        ▼       ▼
                    ┌─────────┐ ┌──────────┐ ┌──────────────────────────────┐
                    │ copy    │ │researcher│ │ worker                       │
                    │ of root │ │read-only │ │ runs a user-defined agent:   │
                    └─────────┘ └──────────┘ │ instructions + tools from DB │ (D11)
                                             └──────────────────────────────┘
                                                        ▲
                     schedules/dispatch.ts (every min) ─┘ due agents (D12)
```

| Kind | Where it's defined | When to use |
|---|---|---|
| Main agent | `agent/agent.ts`, `agent/instructions.md` | Everything, by default |
| Copy of the main agent | built-in `agent` tool | Parallel pieces of the same task |
| Declared subagent | `agent/subagents/<name>/` | A specialist with a narrower prompt or tools |
| Dynamic workflow | `agent/tools/workflow.ts` (eve's `workflow`) | Fan-out and fan-in decided at runtime |
| Authored workflow | `defineWorkflowTool` in `agent/tools/` | Fixed steps that wait for people, webhooks or timers |
| User-defined agent | a row in the `agents` table, run by `worker` | Agents people create in chat |
| Scheduled agent | `schedule` on that row, run by the dispatcher | Recurring work |

## Knowledge

```
 sources ──▶ normalize ──▶ knowledge table (Postgres)
 (Slack,      one Markdown     id, source, url, title, people, ts,
  docs,       doc per thing    visible_to text[], body
  meetings)                          │
                                     │ session start, filtered: caller ∈ visible_to
                                     ▼
                        sandbox /workspace/knowledge/<source>/<id>.md
                                     │
                     agent: glob → grep → read_file → answer with file citations
```

- Each document is a Markdown file with frontmatter, so agents and people can read it (D15).
- Permissions are applied when files are written, so search can't leak (D14).
- The vector index comes later, as a second tool, if the eval shows grep missing vague questions (D13).

## Memory

Three scopes, one git repo each, recalled at the start of every turn (D17):

| Scope | Shared with | Who can save |
|---|---|---|
| `profile` | only that person | the person |
| `team` | the team | any member |
| `company` | everyone | waits for an admin |

Details: [BRAIN.md](BRAIN.md).

## Trust

- **Identity:** dev header under `eve dev` today; Google sign-in next.
- **Chat access:** membership in Postgres, checked on every route.
- **Actions:** `decide()` in `agent/lib/policy.ts` on every tool call (D19). Details: [ORG.md](ORG.md).
- **Apps:** Composio as the user, so access never exceeds the person's (D20).
- **Knowledge:** filtered by `visible_to` before it reaches the sandbox (D14).

## Repo layout

```
agent/
  agent.ts                  model selection
  instructions.md           persona, memory, sharing and approval rules
  channels/eve.ts           auth, chat membership, speaker tags, /glass/v1/sessions
  memory/                   profile, team, company slots
  connections/composio.ts   per-user Composio connection
  tools/                    share_session, request_spend (stub), knowledge tools 🔨
  subagents/                researcher 🔨, worker 📋
  schedules/                dispatcher 📋
  skills/save-as-skill/     turn a procedure into a skill
  lib/
    brain.ts                git-backed memory provider
    sessions.ts             who is in which chat
    policy.ts               action classes, decide(), approval adapters
    composio.ts             Composio tool → action class
db/                         schema and seed
docs/                       this file and the rest of the design docs
```
