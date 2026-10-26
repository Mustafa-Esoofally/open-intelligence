# What production RAG teams learned, and what we take

Date: 2026-10-26. First-party engineering posts first; vendor and secondary sources are marked.
Feeds the design in [RAG.md](RAG.md).

## Reading list

| # | Post | Who | Why read it |
|---|---|---|---|
| 1 | [Knowledge graphs, MCP and DSPy in Dash](https://dropbox.tech/machine-learning/vp-josh-clemm-knowledge-graphs-mcp-and-dspy-dash) | Dropbox, Jan 2026 | the closest product to ours: company-wide index for agents |
| 2 | [How Dash uses context engineering](https://dropbox.tech/machine-learning/how-dash-uses-context-engineering-for-smarter-ai) | Dropbox, Nov 2025 | from RAG to agents: fewer tools, one index |
| 3 | [Two years of vector search at Notion](https://notion.com/blog/two-years-of-vector-search-at-notion) | Notion, 2025 | ingestion at scale, incremental re-embedding, turbopuffer |
| 4 | [Secure codebase indexing](https://cursor.com/blog/secure-codebase-indexing) | Cursor, Jan 2026 | Merkle-tree sync, embedding cache, index reuse across a team |
| 5 | [Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) | Anthropic | the single cheapest retrieval-quality win |
| 6 | [Enhanced Agentic RAG](https://www.uber.com/blog/enhanced-agentic-rag/) | Uber, May 2025 | enrichment + query agents + LLM judges for an internal Slack copilot |
| 7 | [RAG with knowledge graphs for customer service](https://arxiv.org/abs/2404.17723) | LinkedIn, SIGIR 2024 | structure-aware retrieval over tickets; production numbers |
| 8 | [How we built Slack AI to be secure and private](https://slack.engineering/how-we-built-slack-ai-to-be-secure-and-private/) | Slack | stateless RAG, no training on customer data, trust boundary |
| 9 | [turbopuffer + Linear](https://turbopuffer.com/customers/linear) | vendor page | hybrid search across many namespaces in parallel |
| 10 | [How should I evaluate my RAG system](https://hamel.dev/blog/posts/evals-faq/how-should-i-approach-evaluating-my-rag-system.html) | Hamel Husain (cites Jason Liu's "6 RAG evals") | the eval framework to copy |
| 11 | [Document-level RBAC for RAG](https://truto.one/blog/how-to-maintain-document-level-rbac-in-enterprise-rag-pipelines/) | vendor guide | permission-sync failure modes |

## The lessons, with numbers

**Architecture**
- **Index, don't federate.** Dropbox compared querying each app's API live (fresh, no storage, but slow and limited to each API's ranking) with building one index (fast, rankable, company-wide). They chose the index. A simple MCP-based query took up to 45 s; the index answers in seconds. [1]
- **One search tool, not ten.** Every tool definition eats context. Dash replaced 5-10 retrieval tools with one "super tool" over the index and routes complex questions to sub-agents with narrow tool sets. Context is capped around 100k tokens. [1, 2]
- **Graphs feed the index, they don't serve queries.** Dropbox tried a graph database and dropped it for latency and query-pattern reasons. They build the graph offline and turn it into "knowledge bundles" (e.g. everything about one person) that go through the same chunk + embed + BM25 pipeline. [1]
- **Canonical people IDs.** Each app names people differently; resolving them to one identity improved relevance. [1]
- **BM25 is strong on its own.** Dropbox found lexical search did well; dense vectors add to it rather than replace it. [1] Linear runs full-text + vector across several namespaces in parallel, then fuses and reranks: 250M+ docs, 13 ms p50 (vendor-reported). [9]

**Ingestion and freshness**
- **Two paths.** Notion: batch backfill (Spark, now Ray) for onboarding, plus a streaming path (Kafka consumers) for edits with sub-minute freshness. [3]
- **Hash every chunk twice.** Notion keeps a text hash and a metadata hash per span. Text changed → re-embed only that span. Only permissions changed → skip embedding and PATCH metadata. Result: 70% less data written. [3]
- **Cache embeddings by content.** Cursor caches by chunk content hash, so most edits cost nothing to re-embed; a Merkle tree finds exactly which files changed. [4]
- **Reuse indexes across a team.** Cursor seeds a new member's index from a teammate's (92% average similarity between clones in an org): median time-to-first-query went from 7.9 s to 0.5 s, p99 from 4 h to 21 s. Results are filtered to files the client can prove it has. [4]
- **Cost curve.** Notion: 10x scale at about 90% lower cost over two years; turbopuffer cut search spend 60% and p50 latency from 70-100 ms to 50-70 ms. [3]

**Retrieval quality**
- **Contextual retrieval.** Prepend 50-100 tokens of document context to each chunk before embedding and BM25. Failed top-20 retrievals: 5.7% → 3.7% (contextual embeddings) → 2.9% (+ contextual BM25) → 1.9% (+ rerank). About $1 per million document tokens with prompt caching. Retrieve ~150, rerank, pass the top 20. If the whole corpus is under ~200k tokens, skip RAG and put it in the prompt. [5]
- **Enrich before you index.** Uber converts tables to Markdown, keeps table chunks intact, and adds per-doc summaries, per-chunk FAQs and keywords; BM25 runs over that metadata. With a query optimizer (rewrite + split), a source identifier (pick likely docs first) and a post-processor (dedupe, reorder), acceptable answers rose 27% and incorrect advice fell 60% (relative). [6]
- **Keep structure.** LinkedIn built a graph from tickets (explicit links from metadata, implicit from embeddings) and retrieved subgraphs instead of text chunks: MRR +77.6%, median resolution time -28.6% over six months in production. [7]

**Permissions and trust**
- **Filter inside the index, before the prompt.** Post-filtering leaks or returns nothing. Every chunk carries tenant and ACL; cache keys include the caller's scope. [11]
- **Watch permission changes, not just content.** A nightly ACL sync shows revoked documents for hours. [11]
- **Stateless models, no training on customer data,** models inside the trust boundary. [8]

**Evals**
- **Golden set from the experts.** Uber: 100+ real questions with SME answers before launch. [6]
- **Calibrate the judge.** Dropbox measures judge-vs-human disagreement (started at 8%) and drove it down with explanations, a reasoning model, and letting the judge look up context. DSPy then optimizes the 30+ prompts against the evals. [1]
- **Six evals in three tiers:** retrieval metrics (recall, MRR, NDCG); context relevance; answer faithfulness and answer relevance. [10]

## What changes in our design

| Lesson | Change to RAG.md |
|---|---|
| Graph feeds the index [1] | Don't query the knowledge graph live. Materialize **knowledge pages** (per person, customer, project, decision) as documents and index them like everything else. |
| One super tool [1, 2] | Agents get one `search` tool (plus `remember`). Complex questions go to a researcher subagent. |
| Canonical people [1] | Identity resolution is step 1 of ingestion: Slack, Google, GitHub, Linear users → one org user. |
| Text + metadata hash [3] | Permission changes PATCH `visible_to` without re-embedding. |
| Content-hash embedding cache [4] | Never embed the same chunk twice, across sources and people. |
| Contextual retrieval [5] | Every chunk gets a generated context line before embedding and BM25. Retrieve 150, rerank, return 20. |
| Enrichment [6] | Per-document summary, per-chunk keywords/FAQs; tables kept whole. |
| Under 200k tokens [5] | Small orgs and early design partners: skip the index for curated memory, put it straight in context. |
| Batch + stream [3] | Backfill workers + webhook stream from day one. |
| Calibrated judges [1, 6] | R1 eval set gets SME answers and a judge whose disagreement with humans we track. |

## The resulting context engine

```
 sources ─▶ identity resolution ─▶ events ─┬─▶ parse + enrich (summary, keywords, tables)
                                           │      └─▶ chunk ─▶ contextualize ─▶ hash ─▶ embed (cached)
                                           │                                          └─▶ turbopuffer
                                           │                                              BM25 + vector + visible_to
                                           └─▶ extract facts ─▶ graph (offline) ─▶ knowledge pages ─┘
 agent ─▶ search(query) ─▶ rewrite/split ─▶ parallel hybrid queries, filtered as caller
                         ─▶ fuse (RRF) ─▶ rerank 150 → 20 ─▶ + curated memory ─▶ cited context
```
