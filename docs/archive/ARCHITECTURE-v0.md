# open-glass Architecture

Goal: an open-source, self-hostable Ramp Glass. Every employee gets a preconfigured AI workspace on day one, and knowledge compounds ("learn things once").

## 1. System Overview

```
┌──────────────────────────────── DESKTOP CLIENT (Electron) ────────────────────────────────┐
│                                                                                            │
│  RENDERER (React + Tailwind)                    MAIN PROCESS (Node)                        │
│  ┌──────────────────────────────┐   IPC   ┌──────────────────────────────────────────┐   │
│  │ Split panes / tabs (dockview)│◀───────▶│ Session Manager                          │   │
│  │ Chat · Artifacts · Files     │         │  └─ Agent Runtime (Claude Agent SDK)     │   │
│  │ Cost meter · Skill picker    │         │      ├─ skills/  (synced from Dojo)      │   │
│  │ Approvals · Projects         │         │      ├─ memory/  (read-only at start)    │   │
│  └──────────────────────────────┘         │      ├─ bundled CLIs (gws, data, etc.)   │   │
│                                           │      └─ subagents → own session panes    │   │
│                                           │ MCP Connection Pool (connect once)       │   │
│                                           │ Local Scheduler (cron, headless runs)    │   │
│                                           │ Permission Broker (local or phone)       │   │
│                                           │ Auto-updater · SSO token cache           │   │
│                                           └───────────────┬──────────────────────────┘   │
└───────────────────────────────────────────────────────────┼──────────────────────────────┘
                                                            │ HTTPS / WSS
┌───────────────────────────────── CONTROL PLANE (self-hosted) ─────────────────────────────┐
│                                                           │                                │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────┴────────┐  ┌──────────────┐   │
│  │ Auth/SSO  │  │ Connector    │  │ Dojo         │  │ LLM Router   │  │ Session Relay│   │
│  │ OIDC/SAML │  │ Registry +   │  │ skills svc   │  │ + Metering   │  │ (multiplayer)│   │
│  │ SCIM      │  │ Token Vault  │  │ (Git/PR bot) │  │ + Budgets    │  │              │   │
│  └───────────┘  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Memory    │  │ Company      │  │ Sensei       │  │ Slack Gateway│  │ Analytics +  │   │
│  │ Synth     │  │ Knowledge    │  │ recommender  │  │ bots·notify· │  │ Feedback     │   │
│  │ (24h jobs)│  │ (editable)   │  │              │  │ approvals    │  │ triage       │   │
│  └───────────┘  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                                                            │
│      Postgres (Drizzle) · Redis/BullMQ · S3 (memory files, artifacts) · Git (skills repo)  │
└────────────────────────────────────────────────────────────────────────────────────────────┘
        │                    │                        │
        ▼                    ▼                        ▼
  ┌───────────┐     ┌─────────────────┐      ┌──────────────────┐
  │ IdP       │     │ SaaS MCP servers│      │ Model providers  │
  │ Okta/     │     │ Slack Notion    │      │ Anthropic OpenAI │
  │ Google    │     │ Linear Gong SF  │      │ Gemini · local   │
  └───────────┘     │ Snowflake ...   │      └──────────────────┘
                    └─────────────────┘
```

## 2. First Run (zero config)

```
Install app ──▶ "Sign in with SSO" ──▶ IdP (Okta/Google)
                                          │ id_token + groups/role
                                          ▼
                              Control plane: provision user
                                          │
          ┌───────────────────────────────┼───────────────────────────────┐
          ▼                               ▼                               ▼
  Connector Registry              Dojo: role-based               Memory Synth: bootstrap
  central MCP configs,            starter skills                 (collaborators, projects,
  one-click OAuth per tool        (Sensei picks ~5)              channels, docs, tickets)
          │                               │                               │
          └──────────────┬────────────────┴───────────────┬───────────────┘
                         ▼                                ▼
            MCP Pool connects ALL servers         skills/ + memory/ synced
            once (45s → 2s per chat)              to the laptop
                         └──────────────┬─────────────────┘
                                        ▼
                         Ready: first chat, with context
```

## 3. One Message, End to End

```
User types in pane
      │
      ▼
Session Manager ── loads ──▶ system prompt + memory/*.md + company knowledge + project memory
      │
      ▼
Agent SDK loop ◀──────────────────────────────────────────────┐
      │                                                       │
      ├─▶ LLM call ─▶ Router (pick model) ─▶ provider         │
      │                 └─▶ meter: tokens/$ per user/project  │
      │                       └─▶ live cost meter in UI       │
      │                                                       │
      ├─▶ Skill match? ─▶ load SKILL.md instructions          │
      ├─▶ Tool call ─▶ Permission Broker ─┬─ auto-allow       │
      │                                   ├─ ask in UI        │
      │                                   └─ push to phone    │
      │        └─▶ MCP Pool (shared conn) / bundled CLI ──────┤
      ├─▶ Subagent ─▶ new pane (watch / interrupt)            │
      └─▶ File written ─▶ auto-open as artifact tab ──────────┘
      │
      ▼
Session log ─▶ Relay (teammates can join) ─▶ Analytics (skill use, stuck points)
```

## 4. Knowledge Compounding Loops (the core idea)

```
           ┌───────────────── SKILLS LOOP (Dojo) ─────────────────┐
           │                                                       │
 User does great work ─▶ "Save as skill" ─▶ SKILL.md written        │
           ▲                                   │                   │
           │                        "Publish" ─▶ PR bot: branch,   │
           │                                     commit, PR, review│
           │                                   │                   │
           │                              merged ─▶ Dojo catalog    │
           │                                   │                   │
           └──── Sensei recommends to others ◀─┘ (role, tools, usage)

           ┌───────────────── MEMORY LOOP (24h) ──────────────────┐
           │                                                       │
 Sessions + Slack/Notion/Calendar/Linear ─▶ Synth worker (headless agent)
           ▲                                   │ write-once
           │                                   ▼
           │                        memory/{people,projects,resources}.md
           │                                   │ read-only per session
           └──────── every new session ◀───────┘   (inspectable files)

           ┌──────────────── COMPANY KNOWLEDGE LOOP ──────────────┐
 Agent answers wrong ─▶ user corrects ("exclude US cos w/ UK office")
           │                                   ▼
           │                       Knowledge entry (versioned, attributed,
           │                       scoped: org / team / project)
           └──────── injected into everyone's context ◀──────────┘
```

## 5. Automations and Headless Runs

```
Cron (local scheduler, or cloud runner when the laptop is off)
      │
      ▼
Headless session (same skills, memory, MCP) ──▶ needs approval?
      │                                            │ yes
      │                                            ▼
      │                               Slack DM / push: [Approve] [Deny]
      │                                            │
      ▼                                            ▼
Result ──▶ Slack channel / DM / file ◀────── continue
```

## 6. Recommended Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Monorepo | pnpm + Turborepo, TypeScript everywhere | One language across the Agent SDK, desktop, and server |
| Desktop | Electron + React + Tailwind + shadcn/ui, Vite, electron-builder + electron-updater | Agent SDK is Node; this is the proven path (Glass, Open Cowork, OpenWork all use Electron) |
| Panes | dockview (or react-mosaic) | IDE-style split panes and tabs, persisted layout |
| Agent | Claude Agent SDK (TS) | Skills (SKILL.md), MCP, subagents, hooks, permissions built in |
| Model-agnostic | LiteLLM proxy behind the router (Anthropic-compatible endpoint) | Any model; later a custom bandit router (Ramp uses Thompson sampling) |
| Server | Hono or Fastify, Postgres + Drizzle, Redis + BullMQ, S3/R2 | Simple and self-hostable via docker-compose |
| Auth | better-auth (OIDC/SAML) or WorkOS for SSO + SCIM | One login → everything |
| Connector auth | Own token vault (encrypted) + per-tool OAuth; Nango/Composio as an accelerator | Self-healing refresh, central config |
| Skills | Git repo + GitHub App (Octokit) as the PR bot | Versioned, reviewed, invisible to users |
| Memory | Markdown files in S3, synced to client; synth = headless Agent SDK job | Inspectable, write-once-read-many |
| Recommender | pgvector embeddings of skills + usage signals | Sensei v1 is simple ranking |
| Multiplayer | WebSocket relay of the session event log | Join or take over a session |
| Slack | Bolt for JS | Channel bots, notifications, approvals |
| Observability | OpenTelemetry + PostHog | Find stuck points, skill adoption |

## 7. Landscape (what exists, how open-glass differs)

| Project | Stack | Gap vs Glass |
|---------|-------|--------------|
| OpenWork (different-ai) ~24k stars | Electron + React, OpenCode, Den control plane (MCP gateway, skill marketplaces) | Closest. Den is source-available, not MIT. No memory synthesis or company knowledge loop |
| Open Cowork (OpenCoworkAI) ~2.2k | Electron, Agent SDK runner, VM sandbox, skills, Slack | Single-user; no org control plane |
| Open Claude Cowork (Composio) ~4.3k | Electron + Express, Agent SDK, Composio 500+ tools | Demo-grade; no SSO, memory, or skills marketplace |
| Kuse Cowork | Tauri/Rust | Single-user |
| Claude Cowork / Kay (YakLabs) / Ramp Glass | Closed | Not self-hostable |

**open-glass wedge:** the full org loop (SSO → connectors → Dojo → Sensei → memory synth → editable company knowledge → router + metering), MIT-licensed and self-hostable.

## 8. Build Phases

| Phase | Ships |
|-------|-------|
| 0 | Electron shell + Agent SDK chat, split panes, artifacts, local skills folder, BYO API key |
| 1 | MCP Connection Pool + 4 connectors (Slack, Notion, Linear, Google) with OAuth + self-heal |
| 2 | Control plane: SSO, central connector registry, token vault, docker-compose |
| 3 | Dojo: Git-backed skills + PR bot + catalog UI; Sensei v1 |
| 4 | Memory synth (24h) + company knowledge edits + Projects (per-project memory) |
| 5 | Router + metering + budgets + live cost meter |
| 6 | Scheduler + headless + Slack approvals + Slack channel bots |
| 7 | Multiplayer sessions, analytics, auto-update fleet management |
