# Open Intelligence

**Agents do 90% of the work. People do the 10% that needs them.**

Today the person is the integration layer. A request starts in one tool and ends in
five: read the email, paste it into ChatGPT, hunt for the Slack thread and last week's
notes, chase who owns it, find a time, copy the draft back. Thirty minutes of chasing
for one minute of judgment.

Open Intelligence gives every person an agent that does the work first. It reads the
email overnight, pulls the thread, notes and account history, asks the owner's agent,
holds a time with the other agents and drafts the reply with sources. You approve it in
one click. Every approval and edit becomes memory, so the next one needs less of you.

It is the stack the best AI-native companies built for themselves, as one open system
the company owns: its models, its data, its memory, its integrations and its security.

## The loop

```
 Sources ──▶ Ingestion ──▶ Retrieval ──▶ Memory ──▶ Router ──▶ Agent swarms ──▶ Experience ──▶ You decide
 Slack,      parsed into    hybrid        personal,   right model  per-person      Slack, Teams,   approve,
 email,      entities,      keyword +     team,       per task,    agents,         meetings, web,  edit,
 docs,       decisions,     vector +      company,    learned      subagents,      Claude Code,    decide
 meetings,   owners,        graph, only   decision    from         agents asking   Codex
 code, CRM   commitments    what you      memory      results      agents
                            may see
    ▲                                                                                          │
    └──────────────────────────── every decision trains memory ◀───────────────────────────────┘
```

## The stack

Every piece exists somewhere as a part. Open Intelligence connects them into one loop
with one identity and permission model running through all of it.

| Layer | Built on | We add | Status |
|---|---|---|---|
| Agent runtime | [eve](https://eve.dev) (durable sessions, subagents, schedules, sandboxes) | multiplayer chats, membership, speaker tags | ✅ working |
| Human in the loop | eve approvals | policy by action, role and amount; approver routing | ✅ working |
| Memory | git repos of Markdown, optional [Supermemory](https://supermemory.ai) slot | private, team and company scopes, credit for who taught it | ✅ working |
| Integrations | [Composio](https://composio.dev) (500+ apps, per-user OAuth) | policy class for every tool call | ✅ working |
| Ingestion | Composio triggers, Supermemory connectors | event log with who could see what; decisions, owners, commitments | 🔨 next |
| Retrieval | [turbopuffer](https://turbopuffer.com) (BM25 + vector, RRF) | permission filter on every query, runs as the caller | 🔨 next |
| Router | [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) + [AI SDK](https://ai-sdk.dev) | model per task, budgets that pause and ask | 🔨 next |
| Agent swarms | eve subagents, remote agents, Vercel Sandbox | agent-to-agent with scope rules, triggers from commitments | 📋 planned |
| Experience | eve channels (Slack, Teams), MCP channel, Web Chat | Decision Inbox, Claude Code / Codex plugin, meeting bot | 📋 planned |
| Learning | outcomes from every approval and edit | dreaming, autonomy ladder, router that gets cheaper | 📋 planned |

The full analysis is in [`docs/STACK.md`](docs/STACK.md) and the build plan in [`docs/PLAN.md`](docs/PLAN.md).

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
- [ ] Google sign-in, AI Gateway by default, one-click deploy
- [ ] Ingestion: event log, backfill and extraction of decisions and commitments
- [ ] Retrieval: permission-filtered hybrid search on turbopuffer
- [ ] Router: model per task, per-person budgets that pause and ask
- [ ] Agent swarms: subagents, triggers, agent-to-agent, sandboxes
- [ ] Slack bot, Decision Inbox, Claude Code / Codex plugin, meeting bot
- [ ] Learning: edit diffs, dreaming, autonomy ladder

Task-level detail with checks for each step: [`docs/PLAN.md`](docs/PLAN.md).

Design notes: [`docs/STACK.md`](docs/STACK.md), [`docs/BRAIN.md`](docs/BRAIN.md), [`docs/ORG.md`](docs/ORG.md),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
