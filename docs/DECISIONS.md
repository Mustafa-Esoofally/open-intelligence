# Design decisions

Each decision has a short reason and what we rejected. Newest decisions can replace older
ones; when they do, the old one is marked **Replaced** and links to the new one.

Status: **Decided** (building on it), **Trial** (building it to compare), **Open** (still deciding).

## Product

### D1. An agent for every person, not one shared company bot
**Decided.** Each person's agent runs as them: their accounts, their permissions, their
memory. Agents ask each other when they need someone else's context.
*Why:* a shared bot either sees too much or too little. Per-person agents see exactly what
the person could see, and can do work on their behalf.
*Rejected:* one workspace agent per company (how most workspace AI works today).

### D2. The agent does the work first; people decide
**Decided.** Agents act before being asked (overnight email, after a meeting, before a
deadline) and hand people a decision: approve, edit or reject.
*Why:* the value is the 29 minutes of chasing, not the 1 minute of judgment.
*Rejected:* a chat assistant that waits for a prompt.

### D3. Multiplayer from day one
**Decided.** Chats have members, the agent knows who is speaking, and memory has team and
company scopes.
*Why:* AI-native teams already work this way alone in Claude Code and Codex. The gap is
doing it together.

### D4. Open source, and the company owns the stack
**Decided.** MIT licensed. Runs in the company's own cloud. Models, data, memory and
integrations stay with the company.
*Why:* decision memory is the long-term asset, and companies won't build it inside a vendor.

### D5. First users: ops, founders and product leads at 20-150 person startups
**Decided.** Their context lives in Slack, Google Workspace, Notion, Linear and meetings,
and they don't have an AI platform team.

## Runtime

### D6. eve is the agent framework
**Decided.** [eve](https://eve.dev) gives us durable sessions, memory slots, approvals,
subagents, workflows (on the [Workflow SDK](https://workflow-sdk.dev)), schedules,
sandboxes and channels. We build on it instead of beside it.
*Rejected as the core:* LangGraph, Agno, Mastra and LlamaIndex. They are good, but they
overlap with eve, and none solve our hard parts (permissions, freshness, multiplayer).
We may still borrow a library from them for one piece, such as document parsing.

### D7. TypeScript everywhere to start
**Decided.** One language, one deploy. A Python service only if parsing PDFs and decks
needs it (Docling, MinerU).
*Replaces:* the earlier plan for a separate Python data plane ([RAG.md](RAG.md)).

### D8. Stay small: Postgres for everything until it hurts
**Decided.** Users, chats, events, knowledge documents, agents and schedules all live in
one Postgres. No vector database, queue or search cluster yet.
*Why:* at 20-150 people the whole company's text fits in Postgres. Add
[turbopuffer](https://turbopuffer.com) when we pass a few million chunks.

## Agents

### D9. One main agent that can do any task
**Decided.** The root eve agent handles every request. It delegates with eve's built-in
`agent` tool (copies of itself, run in parallel) and declared subagents (specialists with
narrow tools, such as a read-only researcher).

### D10. Dynamic workflows through eve's `workflow` tool
**Decided.** For multi-part work, the main agent writes a small program at runtime that fans
out to subagents and collects the results. Fixed processes that must wait for people,
webhooks or timers are authored as `defineWorkflowTool`.

### D11. People define their own agents, stored as data
**Decided.** A user-defined agent is a row in Postgres: name, instructions, allowed tools,
optional schedule, owner and who can use it. It runs through one generic `worker`
subagent, which gets the row's instructions and tools at runtime.
*Why:* eve subagents are folders compiled at build time, so agents created in chat can't
be folders. Rows can be created, shared, edited and versioned without a deploy.

### D12. Scheduled agents through one dispatcher
**Decided.** One eve schedule runs every minute, claims due agent rows with a lease, and
starts a session for each (eve's dynamic scheduling pattern).

## Knowledge

### D13. Agentic search first, vectors later
**Trial.** The agent searches the way Claude Code does: `grep`, `glob` and `read_file` over
Markdown files in its sandbox, looping until it has the answer, then citing the files.
*Why:* it is simple to build, easy to debug (you can see every grep), exact on names and
numbers, and coding agents moved this way. Vercel reports a 4x cost drop moving one agent
from vectors to files.
*Next:* the same eval questions run against a Postgres vector index (pgvector + full-text).
We keep whichever wins, or both.

### D14. Each session's sandbox holds only what the caller may see
**Decided.** grep sees everything in the sandbox, so permissions are applied when files are
written: at session start, only documents whose `visible_to` includes the caller land in
`/workspace/knowledge`.
*Why:* filtering after search leaks. This is the same rule as filtering inside the index.

### D15. One knowledge document per thing, as Markdown with frontmatter
**Decided.** A Slack thread, a doc, a meeting, a decision or a person page is one file:
frontmatter (source, link, people, date, `visible_to`) plus the text.
*Why:* readable by people and agents, greppable, and the same format as memory.

### D16. Index, don't query apps live
**Decided.** Content is copied into our store and kept fresh by webhooks plus backfill.
*Why:* Dropbox found live API queries slow (up to 45 s) and limited to each app's ranking.
See [RAG-PRODUCTION.md](RAG-PRODUCTION.md).

## Memory

### D17. Memory is git repos of Markdown
**Decided.** Profile, team and company scopes, one git repo each. Every entry is credited
to the person who taught it; `git log` is the audit trail. See [BRAIN.md](BRAIN.md).
*Rejected as the source of truth:* hosted memory services (Supermemory, Mem0). They may come
back as an optional personal slot.

### D18. Recalled memory is data, never instructions
**Decided.** Recalled text is marked as data so a poisoned document can't steer the agent.

## Trust

### D19. Every action is one policy decision
**Decided.** Each tool call is classified (read, write, send, spend, admin, memory) and
`decide()` returns allow, ask someone, or deny. Who may answer is enforced on the server.
See [ORG.md](ORG.md).

### D20. Integrations run as the user
**Decided.** Each person connects their own accounts through Composio. The agent never has
more access than the person.

### D21. Self-hosted first
**Open.** Slack's API terms limit storing other companies' Slack data, which favors each
company running its own install. A hosted version needs a Slack Marketplace agreement.

## Models

### D22. AI Gateway for models, our own router on top
**Decided.** AI Gateway gives one key, fallbacks, logs with cost and per-person budgets. We
pick the model per task at session start and learn from approvals.

## Open questions

1. Coding capture: summaries of Claude Code / Codex sessions, or full transcripts?
2. Meeting bot: Recall.ai, Vexa or Attendee?
3. When a document's permissions change mid-session, refresh the sandbox or end the session?
