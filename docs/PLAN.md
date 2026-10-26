# Build plan

Date: 2026-10-26. The why behind each choice is in [STACK.md](STACK.md), and how the
pieces connect is in [INFRA.md](INFRA.md).

Target for the first month (deck): bots live in Slack and in meetings, collecting
context, with per-person agents that finish routine tasks for design partners.

## How to run this plan with loops

Each task below is sized for one Ralph loop: one goal, a short list of files, and a
**Done when** line that can be checked live (a command, a curl or a chat transcript),
not by a unit test. A loop takes the first unchecked task whose dependencies are done,
works until **Done when** holds, ticks the box, commits, and stops.

Rules for every loop:
- Read `node_modules/eve/docs/` for any eve API before writing code. Do not guess.
- Keep `npm run typecheck` (or `npx tsc --noEmit`) clean and the dev server booting.
- Never weaken `lib/policy.ts` or the membership checks in `channels/eve.ts` to make a task pass.
- New secrets go in `.env.local` and are listed in `.env.example`.
- One task per commit. If **Done when** cannot be met, write why under the task and stop.

```
 P0 foundations ──▶ C collect context (Claude Code, Codex, Slack, Teams) ──▶ P1 app ingestion ──▶ P2 retrieval ──▶ P3 router ──▶ P4 swarm ──▶ P5 surfaces ──▶ P6 learning
   (week 1)          (week 1-2)        (week 2)         (week 2)      (week 3)      (week 3-4)       (week 4+)
                                                          │
                     P5a Slack bot can start right after P0 and run in parallel
```

## P0. Foundations

- [ ] **P0.1 Env and smoke script.** Add `.env.example` and `scripts/smoke.ts` that boots
  against the dev server and checks: db reachable, admin and member resolve, a chat
  round-trips. Done when: `npm run smoke` passes on a fresh clone after the quickstart.
- [ ] **P0.2 AI Gateway as default model path.** Route all model calls through AI Gateway
  (keep direct keys as fallback). Done when: a chat works with only `AI_GATEWAY_API_KEY`
  set, and the request shows in Gateway logs with cost.
- [ ] **P0.3 Google Workspace sign-in.** Real OIDC authenticator in `channels/eve.ts`,
  users auto-provisioned into the org by email domain. Dev header stays for `eve dev`.
  Done when: a deployed preview rejects anonymous calls and accepts a Google login.
- [ ] **P0.4 Deploy.** Vercel project, Neon Postgres, Blob for raw payloads.
  Done when: the preview URL passes `npm run smoke -- --url <preview>`.

## C. Collect context (first milestone, see INFRA.md §7)

Runs right after P0.1. P0.3 (Google sign-in) can come later: C1 uses admin-issued tokens.

- [ ] **C1 Monorepo split.** Move `agent/` to `apps/server/`, add `packages/core` with the
  `OiEvent` schema (zod). Done when: `npm run dev` still works from the root and the smoke script passes.
- [ ] **C2 Ingest + recall API.** `events` table (P1.1 below), per-user API tokens created by
  `oi token create --user <email>`, `POST /oi/v1/events` (batched, idempotent) and
  `POST /oi/v1/recall` on Postgres full-text, filtered by `visible_to`.
  Done when: curl posts 3 events as admin, and recall as member returns only the ones visible to member.
- [ ] **C3 Capture runtime.** `packages/capture`: one bundled `capture.cjs` that handles
  SessionStart, UserPromptSubmit, PostToolUse and Stop JSON on stdin, redacts secrets, keeps
  a cursor and offline queue. Done when: piping a sample Stop payload posts one event, and with the server down it queues and flushes on the next run.
- [ ] **C4 Claude Code plugin.** `plugins/claude-code` + `.claude-plugin/marketplace.json`,
  `userConfig` for server URL and token, remote MCP, hooks, `/oi:status`.
  Done when: `claude plugin validate --strict` passes, and a fact from a session in one repo is injected into a new session's prompt the next day.
- [ ] **C5 Slack passive ingest.** eve Slack channel: un-mentioned messages become events
  with `visible_to` = channel members; mentions get an answer using recall.
  Done when: Claude Code answers "what did #eng decide about X?" from a Slack message.
- [ ] **C6 Codex plugin.** `plugins/codex` + `.agents/plugins/marketplace.json`, same
  capture script, token from `oi login`. Done when: a Codex session's turn arrives as an event.
- [ ] **C7 Teams ambient ingest.** Override eve Teams `onMessage`, manifest with
  `ChannelMessage.Read.Group`. Done when: a standard-channel message arrives as an event without a mention.

## P1. Ingestion from apps and the event log

- [ ] **P1.1 Event log schema.** `events` table: id, org, source, source_id, actor,
  thread, ts, kind, content, `visible_to text[]`, raw_ref. Idempotent on (source, source_id).
  Done when: migrate runs twice cleanly and a sample insert dedupes.
- [ ] **P1.2 Spike: Composio triggers.** Find which sources support webhooks per
  connected account, and the delivery guarantees. Write findings into STACK.md open
  questions. Done when: one Gmail and one Slack event arrive at a local route.
- [ ] **P1.3 Webhook ingest route.** `/oi/v1/ingest/composio` verifies the signature,
  normalizes into `events`, stores raw in Blob. Done when: a new email in a connected
  inbox becomes one row within a minute.
- [ ] **P1.4 Backfill job.** Per connected account, pull the last 90 days (configurable)
  in pages, resumable. Done when: a re-run inserts zero duplicates.
- [ ] **P1.5 Visibility sets.** Gmail: sender + recipients. Slack: channel members.
  Drive: file permissions. Done when: the same Slack message is visible to a channel
  member and not to a non-member in a direct SQL check.
- [ ] **P1.6 Extraction.** AI SDK structured output over new events: people, decisions,
  commitments (owner, due, source event). Tables `entities`, `commitments`.
  Done when: 20 hand-labelled sample threads give commitment precision of 0.8 or better (script prints the score).
- [ ] **P1.7 Spike: Supermemory connectors** for Drive, Notion, GitHub vs doing them via
  Composio. Done when: a recommendation is written into STACK.md.

## P2. Retrieval

- [ ] **P2.1 turbopuffer client + namespace per org.** Done when: a script writes and
  queries 100 docs in the `acme` namespace.
- [ ] **P2.2 Indexer.** Chunk events and brain entries, embed through AI Gateway, upsert
  with `visible_to`, source link, ts. Deletes and visibility changes re-upsert.
  Done when: unsharing a test doc removes it from results within 5 minutes.
- [ ] **P2.3 `search` tool.** Hybrid query (BM25 + ANN, `RRF`), filter
  `visible_to ContainsAny <caller user + groups>`, optional rerank, results with sources.
  Runs only as the session principal. Done when: the member cannot retrieve an admin-only
  email by any phrasing in 10 tries, and the admin can.
- [ ] **P2.4 Recall wiring.** Brain recall at turn start also pulls the top search hits,
  marked as data, not instructions. Done when: "what did Sam say about SOC 2?" answers with a source link.

## P3. Router and budgets

- [ ] **P3.1 Task classifier + routing table.** eve dynamic model at `session.started`:
  task type (chat, draft, research, code, extraction) to a model list in `lib/router.ts`.
  Done when: a research ask and a quick question land on different models (visible in Gateway logs).
- [ ] **P3.2 Per-person budgets.** Gateway budget per team member for hard caps, plus our
  own running total per person and per agent run. Done when: a run that crosses the
  member's limit pauses with an approval card to their lead instead of failing.
- [ ] **P3.3 Outcome logging.** Record model, cost, approve/edit/reject per task for later learning.
  Done when: `outcomes` rows exist for every approved action in a session.

## P4. Agent swarm

- [ ] **P4.1 Declared subagents:** researcher (search + read only), drafter (no send),
  verifier (checks sources). Done when: the morning-email flow from the deck runs end to
  end with three task receipts in the session stream.
- [ ] **P4.2 Triggers.** Event-log triggers (new external email, meeting ended,
  commitment due tomorrow) start a background session for the owner.
  Done when: a commitment due tomorrow produces a drafted follow-up waiting for approval.
- [ ] **P4.3 Agent-to-agent.** Remote agent call from one person's agent to another's,
  `forwardPrincipal`, answers only within the callee's scope or escalates.
  Done when: Priya's agent gets Sam's availability without seeing Sam's calendar details.
- [ ] **P4.4 Sandbox + browser.** Vercel Sandbox for code and files, `agent-browser` for
  web tasks, network policy deny-by-default. Done when: the agent fills a test web form inside the sandbox.

## P5. Surfaces

- [ ] **P5a Slack bot.** eve Slack channel, one thread = one session, members = thread
  participants who are org users. Approvals as Slack buttons. Done when: the 60-second
  demo from the README works fully inside Slack.
- [ ] **P5b Decision Inbox (web).** eve Web Chat + a list of pending approvals across all
  sessions for the signed-in person. Done when: an approver clears a pending spend without joining the chat.
- [ ] **P5c Claude Code / Codex plugin.** eve MCP channel publishing `search`, memory
  save and `agent_start`; a plugin folder with the MCP config and two skills.
  Done when: Claude Code answers "what did we decide about deploy freezes?" from the shared brain.
- [ ] **P5d Meeting bot spike.** Evaluate a meeting-bot vendor for live transcripts into
  the event log. Done when: a recommendation with cost per meeting hour is written into STACK.md.

## P6. Learning

- [ ] **P6.1 Edit diffs.** Store agent draft vs what the person actually sent; extract
  style facts into personal memory for review. Done when: after 5 edited drafts, the 6th needs fewer edits (diff size printed).
- [ ] **P6.2 Dreaming.** Nightly schedule proposes memory merges and stale-fact
  retirements as one reviewable change per scope. Done when: a contradicting fact produces a proposed retirement with both sources.
- [ ] **P6.3 Autonomy ladder.** Per action type per person: draft, act with approval,
  act and report. Promote after N clean approvals, drop on a rejection.
  Done when: after 5 approved calendar holds, the 6th is done and reported, not asked.
- [ ] **P6.4 Router learning.** Use `outcomes` to move task types to cheaper models when
  approval rates hold. Done when: a weekly report shows cost per approved task by model.

## Not now

Org-wide connection admin (MCP enterprise auth), Okta/SCIM, VPC deploys, fine-tuned
models, generated apps. They matter after design partners are live.
