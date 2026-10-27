# Roadmap

What we are building, in order. Each milestone is usable on its own. Task-level detail with
a live check for every step is in [PLAN.md](PLAN.md). Why each piece is built this way is in
[DECISIONS.md](DECISIONS.md).

```
 ✅ M0 Foundations ─▶ 🔨 M1 Agents that know things ─▶ M2 Your own agents ─▶ M3 Collect context
                                                                               │
                      M6 Agents that learn ◀── M5 Agents that coordinate ◀── M4 Deploy for real teams
```

## ✅ M0. Foundations

The base everything else sits on. Working today.

- [x] eve agent with multiplayer chats: members, speaker tags, sharing
- [x] Memory: private, team and company git repos, credited to who taught it
- [x] Approvals: policy by action, role and amount; server-enforced approvers
- [x] 500+ apps through Composio, each person as themselves
- [x] Skills: "save this as a skill"

## 🔨 M1. Agents that know things

The agent can answer "what did we decide about X?" from company knowledge, and split big
asks across subagents.

- [ ] **Knowledge store.** `knowledge` table in Postgres: one Markdown document per thing,
      with source, link, people, date and `visible_to`.
- [ ] **Agentic search.** At session start, the caller's visible documents are written to
      `/workspace/knowledge`. The agent searches with `grep`, `glob` and `read_file` and cites files.
- [ ] **Seed data.** Our own docs and a sample Slack export, so there is something to ask about.
- [ ] **Researcher subagent.** Read-only specialist for deep questions.
- [ ] **Dynamic workflows.** eve's `workflow` tool so the main agent fans out work in parallel.
- [ ] **Baseline eval.** 20+ real questions with known answers, plus permission-leak probes.
      Then the same questions on pgvector, to compare.

*Done when:* admin and member ask the same question and get different, correctly sourced
answers, and the eval prints a score.

## M2. Your own agents

Anyone can create an agent in chat: "every Monday, summarize open Linear issues for my team".

- [ ] `agents` table: name, instructions, allowed tools, schedule, owner, who can use it
- [ ] `save_agent`, `list_agents`, `run_agent` tools, with approval before an agent is shared
- [ ] Generic `worker` subagent that runs any saved agent with its own instructions and tools
- [ ] Dispatcher schedule: every minute, run due agents and post results to their owner

*Done when:* an agent created in chat runs on its schedule and its result reaches the owner.

## M3. Collect context

Bring the company's context in, where people already work.

- [ ] Ingest + recall API (`/oi/v1/events`, `/oi/v1/recall`) with per-user tokens
- [ ] Slack bot: reads channels it is in (with channel permissions), answers when mentioned
- [ ] Claude Code plugin and Codex plugin: capture what was decided in coding sessions, recall it later
- [ ] Teams bot
- [ ] Meeting bot: transcripts as knowledge documents, recap in Slack
- [ ] App sync: Gmail, Drive, Notion, Linear through webhooks plus backfill

*Done when:* Claude Code answers "what did #eng decide about X?" from a Slack thread.

## M4. Deploy for real teams

- [ ] Google Workspace sign-in, users added by email domain
- [ ] AI Gateway as the default model path, with per-person budgets
- [ ] One-command deploy to Vercel with Neon Postgres
- [ ] Smoke test that runs against any deployment

*Done when:* a design partner's team signs in with Google and uses it from Slack.

## M5. Agents that coordinate

- [ ] Agent-to-agent: your agent asks Sam's agent, which answers only within Sam's scope
- [ ] Triggers: new external email, meeting ended, commitment due tomorrow
- [ ] Commitments extracted from threads and meetings (owner, due date, source)
- [ ] Decision Inbox: every pending approval across chats, in one place
- [ ] Sandboxed browser and code for tasks that need them

*Done when:* the morning-email story from the README runs end to end.

## M6. Agents that learn

- [ ] Learn from edits: the draft vs what the person actually sent becomes style memory
- [ ] Nightly cleanup: merge and retire memory as one reviewable change
- [ ] Autonomy ladder per action: draft, then act with approval, then act and report
- [ ] Router learning: move task types to cheaper models when approval rates hold

*Done when:* the 6th edited draft needs fewer edits than the 1st.

## How we measure progress

**Work done:** the share of a person's routine tasks the agent finishes end to end and the
person approves, measured with design partners.

| Stage | Target |
|---|---|
| First design partners | Bots live in Slack and meetings, collecting context |
| 25 design partners | 70-80% of routine tasks done, in each person's own words and workflow |
| Teams in production | Agents coordinate across whole teams |
| Long term | 90%+ of routine work done by agents, cheaper every month as open models improve |

## Not now

Org-wide connection admin, Okta and SCIM, VPC deploys, fine-tuned models, generated apps.
They matter after design partners are live.
