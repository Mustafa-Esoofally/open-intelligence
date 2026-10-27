# Stack analysis: what we use, what we build

> **Update 2026-10-27:** we start smaller than this note: Postgres only, agentic search
> (grep over files) before turbopuffer. See [DECISIONS.md](DECISIONS.md) D8 and D13.

Date: 2026-10-26. Checked against live docs (links inline) and the installed `eve@0.79.0`.

The product loop from the deck, and the piece of the stack behind each step:

```
 SOURCES ──▶ INGESTION ──▶ RETRIEVAL ──▶ MEMORY ──▶ ROUTER ──▶ AGENT SWARMS ──▶ EXPERIENCE ──▶ HUMAN IN THE LOOP
 Slack,      Composio      turbopuffer   git brain   AI Gateway  eve sessions,    Slack/Teams     eve approvals +
 email,      triggers +    hybrid        + Super-    + our own   subagents,       (Chat SDK),     policy.ts,
 docs,       Supermemory   BM25+vector   memory      router via  remote agents,   web, MCP for    decision cards
 meetings,   connectors,   + RRF, ACL    slot        eve dynamic Vercel Sandbox,  Claude Code /
 code, CRM   event log     filters                   models      schedules        Codex
     ▲                                                                                          │
     └──────────────────────────── every approval and edit trains memory ◀──────────────────────┘
```

## The rule

Buy every layer that already exists as a good primitive. Build the glue nobody sells:
**one identity and permission model that flows from the source, through retrieval and
memory, into the agent and the tools it calls, plus learning from every decision.**

## Layer by layer

### 0. Runtime: eve (use)

[eve](https://eve.dev/docs) is the agent framework, and it already ships most of the
swarm runtime. Already in use for sessions, memory slots, approvals and the channel.

| Need | eve feature | Status here |
|---|---|---|
| Durable sessions, multiplayer | sessions + our `channels/eve.ts` membership layer | done |
| Approvals | human in the loop + `lib/policy.ts` | done |
| Scoped memory | memory slots (`defineMemory`, `byPrincipal`) | done (git brain) |
| Subagents | built-in `agent` tool, declared `subagents/`, dynamic subagents | not used |
| Agent-to-agent | remote agents (`defineWorkspaceAgent`, `forwardPrincipal`) | not used |
| Proactive work | `schedules/` (Vercel Cron), dynamic scheduling pattern | not used |
| Isolated execution | Vercel Sandbox, `extension/agent-browser` | not used |
| Slack, Teams, Linear, GitHub | `channels/` (Chat SDK) | not used |
| Claude Code / Codex / Zed | MCP channel (`agent_start`, publish tools/skills), ACP | not used |
| Per-task model | `defineDynamic` on `model` (session/turn/step) | not used |
| Evals | `evals/` (cases, judges, tool stubs) | not used |
| Web UI | `eve add` Web Chat (Next.js) + client SDK | not used |

**Gap eve leaves:** a real SSO authenticator (dev header only today), org-wide connector
admin, per-person budgets that pause instead of fail, and anything to do with company data.

### 1. Ingestion (build on Composio + Supermemory connectors)

- **Live actions:** Composio, per-user OAuth, 500+ apps. Done.
- **Continuous sync:** two sources to evaluate in a spike:
  - [Supermemory connectors](https://supermemory.ai/docs/connectors/overview): Google
    Drive, Gmail, Notion, OneDrive, GitHub (webhooks + every 4 h), Granola, web crawler.
    No Slack. No ACL handling documented.
  - Composio triggers (webhooks per connected account) for Slack, Calendar, Linear and
    the rest. Needs checking against Composio docs before we commit.
- **We build:** one normalized **event log** in Postgres. Every event keeps actor,
  source, thread, timestamp and a **visibility set** (who could see it in the source).
  Raw payloads go to Blob storage. Everything downstream can be rebuilt from this log.
- **We build:** extraction at ingest with AI SDK structured output: people, decisions,
  owners, commitments (owner + due date). Commitments are what make agents proactive.

### 2. Retrieval at scale (turbopuffer)

[turbopuffer](https://turbopuffer.com/docs/query) fits the shape exactly:
- one namespace per org (Notion runs 10M+ namespaces on it);
- hybrid search: up to 16 subqueries per request (BM25 + ANN) fused with `RRF`, then
  optional model reranking;
- ACLs as a filter: store `visible_to: []string` (user ids + group ids) and query with
  `ContainsAny` on the caller's principals, so results are filtered before the model sees them;
- Launch plan from $16/month.

Embeddings and reranking go through AI Gateway, which supports both.

**We build:** chunking, the ACL sync (re-index visibility when a channel or file is
reshared), deletes, a `search` tool that always runs as the caller, and a grep-able
file mirror for exact lookups. Graph search (entities + edges) starts as Postgres tables.

### 3. Memory (git brain, Supermemory as an optional slot)

- **Keep the git brain** for what people teach on purpose: private, team and company
  facts, credited and auditable with `git log`. This is the decision memory, and owning
  it is the moat.
- **Supermemory** has a first-party eve provider (`eve add memory/supermemory`) with
  automatic capture and semantic recall, and a Claude Code plugin with team memory per
  repo (Pro plan). It has no permission model beyond containers, and published tests
  show single-user memory layers leak across principals. Use it as an **optional,
  per-person slot** behind a flag, never as the source of truth for team or company memory.
- **We build:** nightly consolidation ("dreaming") as a reviewable diff, stale-fact
  handling (valid-from / valid-to), and learning from edits (draft vs what was sent).

### 4. Router (AI Gateway + our policy)

[AI Gateway](https://vercel.com/docs/ai-gateway) gives us one key for every provider,
fallbacks, BYOK, zero token markup, request logs with cost, and **budgets per team,
project, key or team member**. Budgets are soft caps and reject requests on overrun.

It picks the provider, not the model. **We build** the model router:
- classify the task at `session.started` (eve dynamic model; switching mid-session
  breaks prompt caching);
- pick by a cost/quality table per task type, then learn from approvals and edits;
- per-person and per-agent budgets that **pause and ask** an approver instead of failing,
  using the existing spend policy.

### 5. Agent swarms (eve)

- **Per-person agent:** one eve agent, principal = the person, their Composio account,
  their scopes.
- **Triggers:** schedules plus event-log triggers (new email, meeting ended, commitment due).
- **Subagents:** researcher, drafter, scheduler, verifier as declared subagents with narrow tools.
- **Agent-to-agent:** Sam's agent asks Priya's agent through remote agents with
  `forwardPrincipal`. It answers within Priya's scope or escalates to Priya.
- **Isolation:** Vercel Sandbox per task, `agent-browser` for logged-in browsing.

### 6. Experience

- Slack and Teams through eve channels (Chat SDK). Slack is the first surface.
- Web: Decision Inbox, Brain browser and Swarm view (eve Web Chat + client SDK).
- Claude Code, Codex and Cursor: publish the agent through eve's MCP channel and ship a
  plugin (skills + MCP config) so the IDE reads and writes the same brain.
- Meeting bot: a vendor such as Recall.ai for the bot, with our pipeline for the live
  transcript. Still to evaluate.

### 7. Human in the loop

Already: policy classes, approver routing by role and amount, server-enforced answers.
To build: decision cards (what happened, what I did, what I need), an approvals inbox,
and an autonomy ladder per action type (draft → act with approval → act and report),
promoted after N clean approvals and demoted on a rejection.

## What we build vs what we use

| Ours (the product) | Theirs (primitives) |
|---|---|
| Identity + permission model end to end | eve runtime, Vercel Workflow, Sandbox |
| Event log, extraction, commitments | Composio, Supermemory connectors |
| ACL-filtered hybrid search tool | turbopuffer |
| Git brain, decision memory, dreaming | Supermemory (optional slot) |
| Model router + pause-and-ask budgets | AI Gateway |
| Agent-to-agent trust rules | eve remote agents |
| Decision Inbox, autonomy ladder | eve HITL, Chat SDK |

## Open questions (resolve in spikes)

1. Composio triggers: which sources, delivery guarantees, per-user vs org.
2. Slack ingestion: Marketplace app as each user vs bot with channel membership.
3. Supermemory: worth the hosted dependency for per-person recall, or is turbopuffer + git enough?
4. turbopuffer region and data residency for design partners.
5. Real SSO: Google Workspace OIDC first (most 20-150 person startups), Okta later.
