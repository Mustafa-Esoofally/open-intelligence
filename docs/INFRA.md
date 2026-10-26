# Agentic infrastructure: how the pieces fit

Date: 2026-10-26. Companion to [STACK.md](STACK.md) (what we buy vs build) and
[PLAN.md](PLAN.md) (the task list). This doc answers: what are the separate pieces,
how do they talk, how does a company install it, and what ships first.

First milestone: **collect context where people already work** (Claude Code, Codex,
Slack, Teams), send it into one company brain, and give it back to them as recall.
Agents doing work comes after the context is flowing.

## 1. The shape: one brain, many thin clients

```
                       ┌──────────────────────────── CLIENTS (thin, installed where people work) ───────────────────────────┐
                       │                                                                                                    │
                       │  Claude Code plugin     Codex plugin        Slack app            Teams app         (later) web,   │
                       │  hooks + MCP + skills   hooks + MCP +       (eve channel)        (eve channel)     meeting bot,   │
                       │                         skills                                                     Cursor         │
                       └──────┬─────────────────────┬──────────────────────┬────────────────────┬─────────────────────────────┘
                              │ capture (events)    │ recall (context)     │ every message      │ every channel message
                              ▼                     ▼                      ▼                    ▼
┌───────────────────────────────────────────────── BRAIN SERVER (one per company, self-hosted or our cloud) ─────────────────────┐
│                                                                                                                              │
│  /oi/v1/events  ──▶  EVENT LOG (Postgres)  ──▶  queue  ──▶  EXTRACT (AI SDK)  ──▶  decisions, owners, commitments, entities   │
│  /oi/v1/recall  ◀──  RECALL (permission-filtered)            │                         │                                     │
│  /eve/v1/mcp    ◀──  search, remember, ask, agent_start      ▼                         ▼                                     │
│  /eve/v1/slack       (eve MCP channel)                   INDEX: turbopuffer       MEMORY: git brain                          │
│  /eve/v1/teams                                           (BM25 + vector,          (private / team / company,                 │
│                                                           visible_to filter)       credited, reviewable)                     │
│                                                                                                                              │
│  identity: Google sign-in ─▶ org user ─▶ per-user token (plugins) / Slack+Teams user mapped by email                         │
│  models: AI Gateway        runtime: eve (sessions, approvals, subagents, schedules)                                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**The contract between pieces is two HTTP APIs and one MCP endpoint:**
- `POST /oi/v1/events`: clients push context (batched, idempotent by `source` + `source_id`).
- `POST /oi/v1/recall`: clients ask "what should the model know right now?" and get a short,
  permission-filtered block back.
- `/eve/v1/mcp`: the agent's tools (`search`, `remember`, `ask_team`, `agent_start`) for any MCP client.

Because the contract is plain HTTP, every client stays thin and replaceable, and
anyone can write a new one (Cursor, a meeting bot, a CRM webhook) without touching the server.

## 2. One repo, separately installable pieces

Keep **one public repo** (stars, issues and docs in one place, shared types, atomic
changes), split into packages that ship on their own:

```
open-intelligence/
├── apps/
│   └── server/                 the brain: eve agent + ingest/recall API (today's agent/ moves here)
├── packages/
│   ├── core/                   event schema (zod), visibility/ACL types, API client (@open-intelligence/core)
│   ├── capture/                hook runtime shared by Claude Code and Codex, bundled to one .cjs file
│   └── cli/                    `oi` CLI: init, login, status, slack/teams manifests (npx open-intelligence)
├── plugins/
│   ├── claude-code/            .claude-plugin/plugin.json, hooks/hooks.json, skills/, .mcp.json
│   └── codex/                  .codex-plugin/plugin.json, hooks/hooks.json, skills/
├── integrations/
│   ├── slack/manifest.yaml     Slack app manifest (scopes, events)
│   └── teams/manifest.json     Teams app manifest (RSC permissions)
├── .claude-plugin/marketplace.json     this repo is a Claude Code marketplace
└── .agents/plugins/marketplace.json    and a Codex marketplace
```

Why not separate repos now: the plugins are tiny and change with the API. Both Claude
Code and Codex install plugins from a marketplace file in a GitHub repo, and that file
can point at a subfolder, so one repo serves both. Split a piece out only when it gets
its own release cadence or contributors.

## 3. How each client works

### 3a. Claude Code plugin (`plugins/claude-code`)

Verified against the [plugin reference](https://code.claude.com/docs/en/plugins-reference)
and [hooks reference](https://code.claude.com/docs/en/hooks).

| Component | What it does |
|---|---|
| `userConfig` | prompts for `server_url` and `token` (`sensitive: true`, stored in the OS keychain) |
| `.mcp.json` | remote HTTP MCP server at `${user_config.server_url}/eve/v1/mcp` with `Authorization: Bearer ${user_config.token}` |
| `SessionStart` hook | asks `/recall` for a brief: team decisions for this repo, your open commitments. Returned as `additionalContext` |
| `UserPromptSubmit` hook | for substantive prompts, asks `/recall` with the prompt and injects the top hits. Hard 1.5 s budget, fails open |
| `PostToolUse` hook (`Edit\|Write\|Bash`) | records files touched and commands run, locally only (cheap, no network) |
| `Stop` hook (`async: true`) | sends the turn: prompt, `last_assistant_message`, files touched, repo remote, branch. Never blocks |
| skills | `remember` (save a fact to personal/team memory with confirmation), `ask-team` (search the brain), `save-as-skill` |
| commands | `/oi:login`, `/oi:status`, `/oi:pause` (stop capture for this repo) |

Every hook runs the same bundled script: `node ${CLAUDE_PLUGIN_ROOT}/capture.cjs <event>`.
It reads the hook JSON on stdin, keeps a per-session cursor and an offline retry queue in
`${CLAUDE_PLUGIN_DATA}`, redacts secret-shaped strings before anything leaves the machine,
and reads the token from `CLAUDE_PLUGIN_OPTION_TOKEN`.

### 3b. Codex plugin (`plugins/codex`)

Codex has near-identical hooks ([docs](https://learn.chatgpt.com/docs/hooks)):
`SessionStart`, `UserPromptSubmit` (with `prompt`), `PostToolUse` (with `tool_response`),
`Stop` (with `last_assistant_message`), and plugins can bundle them in `hooks/hooks.json`.
So the Codex plugin is the same `capture.cjs` with a different manifest
(`.codex-plugin/plugin.json`). Differences to handle:
- Codex has no `userConfig`, so the token comes from `oi login`, which writes
  `~/.config/open-intelligence/credentials.json`. The capture script reads env first, then that file.
- Codex asks the user to review and trust plugin hooks before they run. The README must say so.
- Plugin hooks don't run in cloud ChatGPT Work. Local Codex only for now.

### 3c. Slack (`apps/server/agent/channels/slack.ts`)

eve's Slack channel already gives us this ([eve docs](https://eve.dev/docs/channels/slack)):
`onMessage` receives every message in channels the bot is in (with `message.channels`
+ `channels:history`, and `message.groups` + `groups:history` for private channels).

```
message in #eng ──▶ onMessage
                      ├─ bot mentioned, DM, or active thread ─▶ start/continue an agent turn (reply in thread)
                      └─ otherwise ─▶ write event (visible_to = channel members) ─▶ return null (no reply)
```

- Consent model: the bot only sees channels people invite it to. "Invite @oi to the
  channels it should learn from" is the whole setup for a team.
- Slack users map to org users by email (`users:read.email`).
- Visibility: channel member list, cached and refreshed on `member_joined_channel` /
  `member_left_channel` events.
- Backfill on join: last 90 days of the channel via `conversations.history`.

**Slack terms decide the deployment model.** Slack's API terms (effective 2025-10-10)
forbid persistent copies, archives or indexes of **other organizations'** API data and
forbid training LLMs on it; a commercially distributed app needs a separate agreement.
A company that **installs its own Slack app in its own workspace** (the self-hosted
path) is indexing its own data. Our hosted cloud would be a distributed app and needs
the Marketplace / commercial route first. So: self-hosted is the default, hosted Slack
ingestion waits for that agreement. Get a lawyer to confirm before any hosted launch.

### 3d. Microsoft Teams (`apps/server/agent/channels/teams.ts`)

eve's Teams channel drops messages that don't mention the bot unless `onMessage` is
overridden, and then it receives them. Teams sends un-mentioned channel messages only
with the RSC permission `ChannelMessage.Read.Group` in the app manifest, consented when
the team installs the app ([Microsoft docs](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/channel-messages-with-rsc)).
Standard channels work. Group chats and private channels are unreliable, so start with
standard channels only. Visibility = team membership through Microsoft Graph.

## 4. What gets captured, and who can see it

| Source | Captured | Default visibility |
|---|---|---|
| Claude Code / Codex turn | prompt, final answer, files touched, commands, repo, branch. Not the full transcript | **only you** |
| Repo marked shared (`.oi.json` with a team id, committed) | same | that team |
| Slack / Teams channel message | text, author, thread, files metadata | channel or team members |
| Slack DM with the bot | the conversation | you |

Rules:
- **Private by default.** Coding sessions are personal until a repo opts in. Extraction
  can propose promoting a decision to the team; a person confirms it.
- **Redact before upload.** Secret-shaped strings, `.env` contents and anything under
  ignored paths never leave the machine.
- **`/oi:pause`** stops capture for a repo; the server deletes a person's events on request.
- **Retrieval always runs as the caller** and filters on `visible_to` before the model sees anything.

## 5. The event (the one schema everything shares)

```ts
type OiEvent = {
  source: "claude-code" | "codex" | "slack" | "teams" | "gmail" | string;
  sourceId: string;            // idempotency key with source
  kind: "coding.turn" | "chat.message" | "email" | "doc.change" | string;
  actor: string;               // org user id (email)
  ts: string;                  // ISO time
  thread?: string;             // session id, Slack thread ts, email thread
  context?: { repo?: string; branch?: string; channel?: string; files?: string[] };
  content: string;             // already redacted
  visibleTo: string[];         // user ids and group ids (team:eng, channel:C123)
};
```

Lives in `packages/core`, used by every client and the server.

## 6. Install and run

### Admin, once (target: 10 minutes)

```
npx open-intelligence init
  ├─ deploy the brain server   Vercel (one click) or docker compose (self-host)
  ├─ database                  Neon Postgres (Vercel Marketplace) or local Postgres
  ├─ models                    AI Gateway key, or Anthropic/OpenAI keys
  ├─ search                    turbopuffer key (optional at first: Postgres full-text fallback)
  ├─ sign-in                   Google Workspace OAuth client; your domain = your org
  └─ prints                    server URL + the one-line install for your team

oi slack install     opens Slack "create app from manifest" with integrations/slack/manifest.yaml
oi teams install     builds the Teams app package (manifest + icons) to upload in Teams admin
```

To push the plugin to every engineer without asking them, the admin adds the
marketplace and enables the plugin in Claude Code managed settings, and imports the
GitHub marketplace in the ChatGPT workspace admin for Codex.

### Each person (target: 1 minute)

```
Claude Code:  /plugin marketplace add Mustafa-Esoofally/open-intelligence
              /plugin install oi@open-intelligence      → asks for server URL
              /oi:login                                 → browser Google sign-in, token saved
Codex:        add the marketplace, install from /plugins, then `npx open-intelligence login`
Slack/Teams:  nothing. Invite @oi to channels.
```

## 7. What ships first (the fast path)

Ordered so something useful works at the end of each step:

1. **Ingest + recall API on the server.** `events` table, per-user API tokens (admin
   creates them by CLI before Google sign-in exists), `/oi/v1/events`, and `/oi/v1/recall`
   on **Postgres full-text** first. No turbopuffer yet.
2. **`packages/capture` + Claude Code plugin.** Stop capture, UserPromptSubmit recall,
   `/oi:status`. Proof: a fact from yesterday's session in repo A shows up in today's prompt.
3. **Slack passive ingest.** `onMessage` writes events for un-mentioned messages; mention
   answers with recall. Proof: ask Claude Code "what did #eng decide about deploys?".
4. **Codex plugin.** Same capture script, second manifest.
5. **Extraction.** Decisions and commitments from the event stream.
6. **turbopuffer.** Swap recall to hybrid search with `visible_to` filtering once data volume needs it.
7. **Teams.** RSC ambient messages, standard channels.

After that: agents acting on the context (triggers from commitments, subagents,
agent-to-agent), per PLAN.md.

## 8. Open questions

1. **Hosted Slack:** Marketplace review and a commercial agreement, or self-host only at first?
2. **Coding capture granularity:** turn summaries (cheaper, safer) vs full transcript deltas (richer)?
3. **Memory writes from coding sessions:** automatic personal facts, or only via the `remember` skill?
4. **Codex install command:** confirm the exact `codex plugin marketplace add` syntax against the openai/codex repo.
5. **Supermemory:** its Claude Code plugin is the closest existing design (same hooks:
   SessionStart, UserPromptSubmit, Stop). Learn from it rather than depend on it.
