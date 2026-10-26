# Memory-first RAG: ingestion, retrieval and refresh

Date: 2026-10-26. GitHub numbers pulled from the GitHub API on that date. Companion to
[INFRA.md](INFRA.md) (clients and contracts) and [STACK.md](STACK.md) (buy vs build).

The goal: every data point a company produces (chat, email, docs, code, meetings, calls,
tickets, CRM) flows into one brain that stays fresh, knows who may see what, and gives
agents the right context in under a second.

## 1. The model: four layers of memory

```
            WRITE PATH (continuous)                                        READ PATH (every turn, < 1 s)
                                                                           
 touchpoints ─▶ 1. EVENTS ─▶ 2. INDEX ─────────▶ 3. KNOWLEDGE ─▶ 4. CURATED      query + caller
 (webhooks,     raw, append-  chunks with         entities, facts   git brain:        │
  bots, hooks,  only, ACL     visible_to,         with valid-from/  what people       ▼
  polling)      per event     BM25 + vector       valid-to, owners, taught on       ┌───────────────────────────┐
                (Postgres +   (turbopuffer)       decisions,        purpose,         │ parallel strategies:      │
                 Blob)                            commitments,      reviewed,        │  BM25 · vector · graph ·  │
                                                  observations      credited         │  time range · curated     │
                                                  (Postgres graph)                   │ filter: visible_to ∋ me   │
                                                                                     │ fuse: RRF → rerank        │
                  ◀──────── REFRESH: webhooks, reconcile sweeps, nightly consolidation ───────── │ trim to token budget      │
                                                                                     └───────────────────────────┘
```

| Layer | Holds | Answers | Refreshed by |
|---|---|---|---|
| 1. Events | every message, email, doc change, transcript, turn, as received | "show me the source" | source webhooks and backfills |
| 2. Index | chunks of events and documents | "find the passage about X" | re-chunk on change, delete on delete, re-ACL on reshare |
| 3. Knowledge | entities, facts with time validity, decisions, commitments, consolidated observations | "who owns X", "what's true now", "what did we decide" | extraction on new events; contradictions invalidate old facts |
| 4. Curated | facts people taught or approved, per person / team / company | "our rule is X" (highest trust) | people, plus nightly proposals they review |

Recall always reads all four, ranks curated and current facts above raw passages, and
cites the event behind every claim.

## 2. Touchpoints: every data point and how to get it

| Touchpoint | How we collect | Who may see it (ACL source) | Freshness |
|---|---|---|---|
| Slack, Teams channels | eve channel, every message (INFRA.md §3) | channel / team members | real time |
| Claude Code, Codex | plugin hooks (INFRA.md §3) | you, or the team for shared repos | per turn |
| Email (Gmail, Outlook) | push (Gmail Pub/Sub, Graph subscriptions) per user | sender + recipients | real time |
| Calendar | push per user | attendees | real time |
| Docs (Drive, Notion, Confluence, SharePoint) | webhooks + periodic reconcile | file / page permissions | minutes |
| Tickets (Linear, Jira, GitHub issues) | webhooks | project / repo members | real time |
| Code (GitHub) | webhooks: PRs, reviews, commits | repo access | real time |
| CRM (HubSpot, Salesforce) | webhooks / polling | record owner + team | minutes |
| Support (Intercom, Zendesk) | webhooks | support team | real time |
| **Meetings** (Zoom, Meet, Teams) | a meeting bot joins from the calendar invite; live transcript | invitees | live |
| **Phone calls** | eve Twilio channel (speech-transcribed calls + SMS); realtime voice later via LiveKit Agents or Pipecat | caller + owner | live |
| Files people drop in | upload → parse | uploader, or chosen scope | on upload |

**Connector plumbing (pick one, keep the rest as fallbacks):**

| Option | What it is | Fit |
|---|---|---|
| Composio (in use) | per-user OAuth + 500+ app actions, triggers | great for actions, verify sync/trigger depth |
| [Nango](https://github.com/NangoHQ/nango) (13k stars, Elastic license) | OAuth for 1,000+ APIs, syncs written as TypeScript functions, webhooks | best fit for **sync** we control; free self-host is feature-limited |
| [Airbyte](https://github.com/airbytehq/airbyte) (22k) | 600+ ELT connectors | warehouse-shaped, heavy; not per-user ACL |
| Native webhooks | Gmail Pub/Sub, Graph, Slack, GitHub | most reliable for the top 5 sources; write these ourselves |

Recommendation: native for the top sources (Slack, Teams, Gmail/Outlook, Calendar,
GitHub), Composio for actions, evaluate Nango for the long tail of syncs.

## 3. The write path in detail

1. **Normalize** to one `OiEvent` (INFRA.md §5) with `visibleTo`. Store raw payloads in Blob.
2. **Parse** attachments and docs: [Docling](https://github.com/docling-project/docling)
   (70k stars, MIT, runs locally) by default; [MinerU](https://github.com/opendatalab/MinerU)
   (83k) for hard PDFs with tables and formulas. Meeting and call audio arrive as transcripts.
3. **Chunk** by structure (headings, messages, speaker turns), not fixed size. Keep the
   thread or document title in every chunk.
4. **Embed + index** in turbopuffer, one namespace per org, with `visible_to`, `source`,
   `ts`, `event_id`. Embeddings through AI Gateway.
5. **Extract** with a cheap model: entities (people, customers, projects, systems),
   facts as triplets with `valid_from`, decisions, commitments (owner, due). Every fact
   points to its source events.
6. **Consolidate**: new facts that contradict old ones close the old fact's validity
   window instead of deleting it (Graphiti's approach). Repeated evidence strengthens an
   **observation** with a proof count (Hindsight's approach).
7. **Curate**: a nightly job proposes merges, retirements and new company facts as one
   reviewable change per scope; people approve into the git brain.

## 4. Refresh: how memory stays true

| Change in the world | What we do |
|---|---|
| New message / doc / email | webhook → event → index + extract within a minute |
| Edit | new version event; re-chunk; facts from the old version are re-checked |
| Delete | tombstone event; delete chunks; facts sourced only from it are retired |
| Permission change (reshare, left channel) | **reconcile sweep**: a light pass that fetches only ids + ACLs per source every few minutes and rewrites `visible_to` (Onyx calls this a slim sync) |
| Fact goes stale ("Sam owns billing" → Priya does) | contradiction closes the old fact's validity window |
| Nothing new, but memory got messy | nightly consolidation, as a reviewable diff |
| Embedding model upgrade | re-embed from the event log; everything derived is rebuildable |

## 5. The read path (recall)

Run in parallel, all filtered by `visible_to ContainsAny <caller + groups>` before anything is returned:
1. **Keyword** (BM25) and **vector** over chunks: turbopuffer multi-query with `RRF`.
2. **Graph**: facts about entities named in the query (Postgres).
3. **Time**: "last week", "in Q3" → time-range filter.
4. **Curated**: git brain topics for the caller's scopes.

Then fuse (RRF), rerank (AI Gateway reranking), trim to a token budget, and return each
item with its source link. Agentic RAG on top: the eve agent can call `search` again
with a refined query, or hand a broad question to a researcher subagent.

## 6. Open-source projects to learn from

| Project | Stars | License | What to take from it |
|---|---|---|---|
| [RAGFlow](https://github.com/infiniflow/ragflow) | 93k | Apache-2.0 | deep document understanding, chunking templates per doc type |
| [Docling](https://github.com/docling-project/docling) | 70k | MIT | **use it**: local parsing for PDFs, Office, HTML |
| [Mem0](https://github.com/mem0ai/mem0) | 68k | Apache-2.0 | fact extraction + update rules (add / update / delete / noop) |
| [Hindsight](https://github.com/vectorize-io/hindsight) | 54k | MIT | retain / recall / reflect; 4 parallel strategies + RRF + cross-encoder; observations with proof counts; banks; secret redaction. **Closest to our design, candidate to adopt** |
| [LlamaIndex](https://github.com/run-llama/llama_index) | 53k | MIT | retrieval primitives: recursive / auto-merging retrieval |
| [LightRAG](https://github.com/HKUDS/LightRAG) | 40k | MIT | cheap graph + vector dual-level retrieval, incremental inserts |
| [GraphRAG](https://github.com/microsoft/graphrag) | 36k | MIT | community summaries for "global" questions; expensive to build |
| [Onyx](https://github.com/onyx-dot-app/onyx) | 33k | MIT core + EE | **reference architecture** for enterprise RAG: connectors, workers, hybrid index, permissions across interfaces |
| [Cognee](https://github.com/topoteretes/cognee) | 33k | Apache-2.0 | graph + vector "company brain" pipelines |
| [Graphiti](https://github.com/getzep/graphiti) | 32k | Apache-2.0 | **temporal facts**: validity windows, invalidate-not-delete, incremental. No auth: tenancy is ours |
| [Supermemory](https://github.com/supermemoryai/supermemory) | 31k | MIT | connectors + Claude Code plugin design |
| [Letta](https://github.com/letta-ai/letta) | 25k | Apache-2.0 | memory blocks, background ("sleep-time") memory agents |
| [Vexa](https://github.com/Vexa-ai/vexa) | 3k | Apache-2.0 | self-hosted meeting bots + live transcripts |
| [Attendee](https://github.com/attendee-labs/attendee) | 0.8k | see repo | meeting bot API for Zoom / Meet / Teams, Docker + Postgres + Redis |
| [LiveKit Agents](https://github.com/livekit/agents) / [Pipecat](https://github.com/pipecat-ai/pipecat) | 15k / 17k | Apache / BSD | realtime voice agents for calls |
| [Pathway](https://github.com/pathwaycom/pathway) | 62k | BSL 1.1 | incremental live indexing; license blocks embedding it in our open core |
| [Airweave](https://github.com/airweave-ai/airweave) | 6.5k | MIT, **archived Aug 2026** | connector + sync design to read, not depend on |

Commercial references: Glean (permission-aware enterprise graph), Recall.ai (meeting
bots, widest platform coverage).

## 7. Which agent framework

Framework choice matters less than retrieval quality, permissions and freshness. The
split that works:

```
 AGENT PLANE (TypeScript)                         DATA PLANE (Python)
 eve: sessions, approvals, subagents,             ingestion workers: normalize, parse (Docling),
 channels (Slack, Teams, Twilio, MCP),     HTTP   chunk, embed, extract, consolidate, reconcile
 schedules, sandboxes                    ◀──────▶ memory engine: Hindsight or Graphiti, or ours
 tools: search, remember, ask_team                index: turbopuffer · graph + events: Postgres
 models via AI Gateway                            models via AI Gateway (OpenAI-compatible)
```

- **Keep eve for agents.** It's what we already run, and it has the multiplayer,
  approvals, channels and subagents we need. Agentic RAG here is just the agent calling
  a good `search` tool, iteratively, as the caller.
- **Python for the data plane, without an agent framework.** The best parsers (Docling,
  MinerU) and memory engines (Hindsight, Graphiti, Mem0, LightRAG) are Python. Ingestion
  is pipelines and workers, not agents, so plain workers + direct model calls through
  AI Gateway are enough.

| Alternative | Why not as the core |
|---|---|
| Agno (43k, Python) | strong knowledge + agentic RAG, and you know it deeply; but it would be a second agent runtime next to eve, and turbopuffer isn't in its listed vector DBs |
| Mastra (29k, TS) | good memory (observational memory) and RAG in TS; overlaps eve almost entirely |
| LangGraph (44k) | best for complex stateful graphs; we'd rebuild what eve gives us |
| LlamaIndex (53k) | use as a **library** for retrieval tricks if we need them, not as the runtime |
| Pydantic AI (21k) | clean typed agents; no RAG advantage for us |

## 8. Decide with evals, not opinions

Before choosing the memory engine, build a small eval from real (design-partner or our
own) data and score every candidate on it:
- **Recall@10 and answer faithfulness** on 50 real questions with known source events.
- **Freshness:** time from a source change to a correct answer.
- **Permission leaks:** questions asked as someone who should not see the answer
  (GateMem-style). Target: zero.
- **Staleness:** questions whose answer changed; the old answer must not win.
- **Cost and latency** per 1,000 events ingested and per recall.

## 9. Spikes to run first

1. **Memory engine bake-off:** Hindsight vs Graphiti vs our own (turbopuffer + Postgres
   facts) on the eval above. Check Hindsight's per-document ACL story; banks + metadata
   filters may not express `visible_to` sets.
2. **Meeting bot:** Vexa vs Attendee self-hosted vs Recall.ai, cost per meeting hour and
   Teams support.
3. **Connector sync:** Nango vs Composio triggers for Drive, Notion, HubSpot.
4. **Parser:** Docling vs MinerU on 20 real company PDFs and decks.
