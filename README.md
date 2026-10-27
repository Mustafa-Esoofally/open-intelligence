# Open Intelligence

**Agents do 90% of the work. People do the 10% that needs them.**

An open-source stack that gives every person at a company an agent that does the work
first. It reads the email, finds the Slack thread and the meeting notes, asks the owner's
agent, holds a time and drafts the reply with sources. You approve it in one click, and
every approval teaches it.

The company owns all of it: the models, the data, the memory, the integrations and the
security. Built on [eve](https://eve.dev), Vercel's framework for durable agents.

> **Status: early.** Memory, multiplayer chats, approvals and 500+ app integrations work
> today. Knowledge search, agent swarms and the Slack bot are being built now.
> See the [roadmap](docs/ROADMAP.md).

## Why

![Today, the person is the integration layer](docs/images/problem.svg)

Every request starts in one tool and ends in five. People read the email, paste it into
ChatGPT, hunt for the Slack thread, chase the owner and find a time, then copy the draft
back. AI chat tools haven't fixed this, because each one only sees what you paste in,
setup lives with one person, and nothing it learns is kept.

## What changes

![The agent does the work first](docs/images/proactive.svg)

The agent works **before** you ask: overnight, after a meeting, before a deadline. It
gathers the context, asks other people's agents, and hands you a decision. In a meeting,
the bot surfaces facts live (deal size, SOC 2 status, owner), drafts the follow-ups, and
the recap is waiting in Slack before the call ends.

## How it works

![Every piece exists in parts. We connect them into one loop](docs/images/loop.svg)

Every piece exists somewhere as a part. Open Intelligence connects them into one loop,
with one identity and permission model running through all of it.

| Layer | What it does | Built on |
|---|---|---|
| **Sources** | Slack, email, meetings, docs, code, CRM | [Composio](https://composio.dev), native webhooks |
| **Ingestion** | Turns everything into documents with who could see them, plus decisions, owners and commitments | Postgres event log |
| **Knowledge** | The agent searches like Claude Code does: grep, glob and read over the files the caller is allowed to see | eve sandbox |
| **Memory** | Personal, team and company memory as git repos of Markdown, credited to whoever taught it | eve memory slots |
| **Router** | Picks a model per task, with budgets that pause and ask instead of failing | [AI Gateway](https://vercel.com/docs/ai-gateway) |
| **Agent swarms** | A main agent that does any task, specialist subagents, agents you define yourself, scheduled agents | eve subagents, workflows, schedules |
| **Experience** | Where people use it: Slack, Teams, meetings, web, Claude Code and Codex | eve channels, MCP |
| **Human in the loop** | Approvals by action, role and amount. Autonomy is earned over time | eve approvals + our policy |

Why each piece was chosen: [docs/DECISIONS.md](docs/DECISIONS.md). How the parts fit:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Where this is going

![Every company runs on its own open intelligence stack](docs/images/stack.svg)

Every team (ops, sales, engineering, support, finance) uses one shared stack that the
company owns and runs. Any model plugs in underneath, decision memory builds up inside the
company instead of inside a vendor, and the router gets cheaper as it learns.

## What works today

- **A brain you can read.** Every person, team and company gets its own memory, stored as
  a plain git repo of Markdown. `git log` shows who taught the agent what. Open it in
  Obsidian, Cursor or Claude Code.
- **Multiplayer chats.** Bring a colleague into a conversation. The agent knows who is
  speaking, and only people in the chat can see it.
- **Your apps, as you.** Gmail, Calendar, Drive, Slack, Notion, Linear, GitHub and 500+
  more through Composio. Each person connects their own accounts, so the agent sees
  exactly what they see.
- **Approvals that match your org.** Reads just run. Sends and deletes ask first. Company
  memory needs an admin. Spend routes by amount to you, your lead or finance.
- **Skills that spread.** Say "save this as a skill" and it becomes a procedure for everyone.

## Quickstart

Requires Node.js 24+ and Docker.

```bash
git clone https://github.com/Mustafa-Esoofally/open-intelligence.git && cd open-intelligence
npm install
echo 'DATABASE_URL=postgres://glass:glass@127.0.0.1:5432/glass' >> .env.local
npm run db:up        # Postgres 17 in Docker
npm run db:migrate   # org "acme", team "eng", admin@example.com and member@example.com
npm run dev          # http://localhost:2000 + terminal UI
```

Run `/login` in the terminal UI to connect a model (Anthropic, OpenAI or AI Gateway). You
chat as `admin@example.com`. Walkthroughs for memory, shared chats, approvals and
connecting apps are in [docs/TRY-IT.md](docs/TRY-IT.md).

## Roadmap

| Milestone | What ships |
|---|---|
| ✅ **Foundations** | Git-backed memory, multiplayer chats, approvals, Composio apps |
| 🔨 **Agents that know things** | Agentic knowledge search with permissions, main agent + subagents, dynamic workflows |
| 📋 **Your own agents** | Define an agent in chat, run it on demand or on a schedule |
| 📋 **Collect context** | Slack and Teams bots, Claude Code and Codex plugins, meeting bot |
| 📋 **Agents that coordinate** | Agent-to-agent with scope rules, triggers from commitments, Decision Inbox |
| 📋 **Agents that learn** | Learning from edits, nightly memory cleanup, autonomy ladder, cheaper routing |

Details and order: [docs/ROADMAP.md](docs/ROADMAP.md). Task-by-task build plan:
[docs/PLAN.md](docs/PLAN.md).

## Docs

| Doc | What's in it |
|---|---|
| [ROADMAP](docs/ROADMAP.md) | Milestones, what each one ships, how we measure it |
| [DECISIONS](docs/DECISIONS.md) | Every design decision, with the reason and what we rejected |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | The parts, how a request flows, the repo layout |
| [PLAN](docs/PLAN.md) | Build tasks sized for one agent loop each, with a live check |
| [TRY-IT](docs/TRY-IT.md) | Hands-on walkthroughs of what works today |
| [More](docs/README.md) | Research notes: stack, infra, RAG, memory, org model |

## Contributing

Early and moving fast. Run it locally, break it, and open issues. Auth is dev-only for
now: the `x-glass-user` header works only under `eve dev`.

## License

[MIT](LICENSE)
