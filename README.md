# Open Intelligence

**The full stack for owning intelligence.**

Every company will run on intelligence. Today it comes in pieces: a parser here, a
vector database there, a memory library, a model router, a few MCP servers and a
single-player chatbot. Every company that wants more ends up rebuilding the same stack
in-house. Open Intelligence builds it once, in the open, as one system you own:
ingest everything your company knows, retrieve it with permissions, remember what
people teach it, route each task to the right model, and run swarms of agents that do
the work while people make the decisions.

```
┌─────────────────────────── 6. EXPERIENCE ───────────────────────────┐
│ where people work with agents: chat, Slack, meetings, your IDE      │
├─────────────────────────── 5. AGENT SWARMS ─────────────────────────┤
│ per-person agents, subagents, agent-to-agent work, proactive        │
│ triggers, with approvals, budgets and permissions                   │
├─────────────────────────── 4. ROUTER ───────────────────────────────┤
│ picks the model per task by cost and quality, learns from results   │
├─────────────────────────── 3. MEMORY ───────────────────────────────┤
│ private, team and company memory, sourced, credited, versioned      │
├─────────────────────────── 2. RETRIEVAL AT SCALE ───────────────────┤
│ advanced RAG over the whole company: keyword + vector + graph,      │
│ filtered by who is asking                                           │
├─────────────────────────── 1. INGESTION ────────────────────────────┤
│ every source (mail, Slack, Drive, meetings, code, tools), parsed    │
│ into structure at ingest: entities, decisions, owners, commitments  │
└─────────────────────────────────────────────────────────────────────┘
  open and pluggable at every layer: your models, your vector DB, your connectors
```

| Layer | Today | Next |
|---|---|---|
| 1. Ingestion | Live reads from 500+ apps through Composio, per user | Continuous sync, document parsing, extraction of decisions and owners |
| 2. Retrieval | Keyword recall over memory topics | Hybrid keyword + vector + graph search, permission-filtered |
| 3. Memory | Git-backed private, team and company memory with attribution | Nightly consolidation ("dreaming") as reviewable changes |
| 4. Router | One model, chosen by which key you set | Per-task routing by cost and quality, learned from outcomes |
| 5. Agent swarms | Multiplayer chats, policy-gated tools, cross-person approvals | Background agents, subagents, agent-to-agent handoffs, budgets |
| 6. Experience | Terminal UI and HTTP API | Approvals inbox, Slack bot, meeting bot, web workspace |

## What works today

- **A brain you can read.** Every person, team and company gets its own memory, stored
  as a plain git repo of Markdown files. Every entry is credited to the person who taught
  it, and `git log` shows who taught the agent what. Open it in Obsidian, Cursor or Claude
  Code and use the same memory there.
- **Multiplayer chats.** Bring a colleague into a conversation. The agent knows who is
  speaking, credits what each person said, and only people in the chat can see it.
- **Your apps, as you.** Gmail, Calendar, Drive, Slack, Notion, Linear, GitHub and 500+
  more through [Composio](https://composio.dev). Each person connects their own accounts,
  so the agent sees exactly what they see and nothing more.
- **Approvals that match your org.** Reads just run. Sends, deletes and changes other
  people will see ask first. Company-wide memory needs an admin. Spend routes by amount
  to you, your lead or finance.
- **Skills that spread.** Say "save this as a skill" after the agent does something
  useful, and it becomes a reusable procedure for everyone.

Built on [eve](https://eve.dev), Vercel's framework for durable agents. Bring an
Anthropic or OpenAI key, or use the Vercel AI Gateway.

## See it in 60 seconds

Two people, one shared brain:

```
member   "We freeze deploys on Fridays after noon ET. Remember that for the team."
agent    Saved to team memory (deploys).            → git commit by member

admin    (new chat) "Can I ship at 3pm Friday?"
agent    No. Deploys freeze Fridays after noon ET
         (team memory, added by member on 2026-10-23).

member   "Add to company memory: we don't sell to US companies with only a UK office."
agent    Company saves need an admin. Waiting for approval.
member   approves it themselves                     → rejected
admin    approves                                   → saved, still credited to member
```

## Quickstart

Requires Node.js 24+ and Docker.

```bash
git clone https://github.com/Mustafa-Esoofally/open-intelligence.git && cd open-intelligence
npm install
echo 'DATABASE_URL=postgres://glass:glass@127.0.0.1:5432/glass' >> .env.local
npm run db:up        # Postgres 17 in Docker
npm run db:migrate   # org "acme", team "eng", admin@example.com and member@example.com
npm run dev          # local server on http://localhost:2000 + terminal UI
```

To use your own emails, add them in `db/seed.local.sql` (gitignored) and re-run
`npm run db:migrate` whenever you change it. The first time, run `/login` in the
terminal UI to connect a model. You chat as `admin@example.com` unless you set `GLASS_DEV_USER`.

To be a second person at the same time, attach another terminal to the running server:

```bash
npx eve remote connect --url http://localhost:2000 -H "x-glass-user: member@example.com"
```

### Connect apps

1. At [platform.composio.dev](https://platform.composio.dev), switch to **Platform**,
   open your project, then **API Keys → Create API Key**. Use the `ak_` key; the `ck_`
   key under account settings is for MCP clients.
2. `echo 'COMPOSIO_API_KEY=ak_...' >> .env.local` and restart `npm run dev`.
3. Ask "connect my Gmail". The agent replies with a link; open it and approve.

Then try "what's on my calendar tomorrow?" or "summarize my last 3 emails".

## Try it

**Memory.** Say "I prefer terse answers", start a new chat with `/new`, and ask "what do
you know about me?". Teach a team rule as one user and ask about it as the other.

**Shared chats.** As the admin: "Bring `member@example.com` into this chat." The agent
asks you to confirm, since they will see the full history. The member finds the chat
with `curl -H "x-glass-user: member@example.com" http://localhost:2000/glass/v1/sessions`
and joins it.

**Approvals.** As the member, whose own spend limit is $100:

| Ask | What happens |
|---|---|
| "Request a $40 spend at Figma for a design seat." | The member confirms it |
| "Request a $300 spend at Datadog." | Needs a team lead or admin; the member's own approval is rejected |
| "Request a $9,000 spend at AWS." | Needs finance |
| "Request a $30,000 spend." | Denied, above the org maximum |

There is no approvals inbox yet, so the approver answers from inside the chat (add them
with "bring them into this chat") or through the HTTP API with the request id from the
session stream:

```bash
curl -X POST http://localhost:2000/eve/v1/session/<sessionId> \
  -H "x-glass-user: admin@example.com" -H "content-type: application/json" \
  -d '{"inputResponses":[{"requestId":"<requestId>","optionId":"approve"}]}'
```

**Skills.** After the agent does something useful, say "save this as a skill".

## How it works

**Memory** lives under `.data/brain/` (`GLASS_BRAIN_DIR` to move it), in the
[Agent Memory Repo](https://github.com/AgentMemoryRepo) layout:

```
.data/brain/
  profile/acme/<email>/   private to that person         saves directly
  team/acme/eng/          shared with the team           any member saves
  company/acme/           shared with everyone           saves wait for an admin
    MEMORY.md             index of topics
    deploys.md            - Freeze deploys Fridays after noon ET [by: …; added: 2026-10-23; source: <chat>]
```

Each save is one commit authored by the person who taught it. Relevant topics are
recalled at the start of every turn as data, never as instructions, and secrets are
refused before they reach disk.

**Access.** eve authenticates every request but does not check whose chat it is.
`agent/channels/eve.ts` adds that: every chat route checks membership in Postgres
(others get a 404), the creator is recorded when a chat starts, and each message
reaches the model tagged with its sender.

**Policy.** Every tool call is classified, then `decide()` in `agent/lib/policy.ts`
returns allow, ask someone, or deny:

| Action | Rule |
|---|---|
| Reads, your own drafts, team memory | Run |
| Sends, deletes, changes others will see, code in the Composio workbench | The requester confirms |
| Company memory | An admin approves |
| Spend | By amount: you, then a team lead, then finance; denied above the org maximum |
| Payments through connected apps | Denied |

App tools are classified from Composio's own read-only and destructive hints first,
then from the tool name (`agent/lib/composio.ts`). Who may answer an approval is
enforced on the server, not trusted to the UI.

```
agent/
  agent.ts                  model selection
  instructions.md           persona, memory, sharing and approval rules
  channels/eve.ts           auth, chat membership, speaker tags, /glass/v1/sessions
  memory/                   profile, team, company slots
  lib/brain.ts              git-backed memory provider
  lib/sessions.ts           who is in which chat
  lib/policy.ts             action classes, decide(), approval adapters
  lib/composio.ts           Composio tool -> action class
  connections/composio.ts   per-user Composio connection
  tools/                    share_session, request_spend (a stub; no money moves)
  skills/save-as-skill/     turn a procedure into a skill
db/                         schema and seed (orgs, teams, users, chats)
```

## Status

Early and moving fast. Auth is dev-only: the `x-glass-user` header works only under
`eve dev`, and a deployment rejects every request until you plug in real SSO in
`agent/channels/eve.ts`. Run it locally, break it, and open issues.

## Roadmap

- [x] Git-backed private, team and company memory with attribution
- [x] Multiplayer chats with membership and sharing
- [x] 500+ apps through Composio, with policy-gated writes
- [ ] Approvals inbox, so approvers don't need to join each chat
- [ ] Ingestion pipeline: continuous sync and document intelligence across every source
- [ ] Advanced RAG: hybrid keyword, vector and graph retrieval with permissions
- [ ] Dreaming: nightly memory cleanup proposed as a reviewable change, with undo
- [ ] Router: per-task model choice that learns from a team's own results
- [ ] Agent swarms: background agents, subagents and agent-to-agent work with budgets
- [ ] Slack bot, meeting bot and a web workspace
- [ ] Real SSO (OIDC) and deployment

Design notes: [`docs/BRAIN.md`](docs/BRAIN.md), [`docs/ORG.md`](docs/ORG.md),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
