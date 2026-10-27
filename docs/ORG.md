# Open Intelligence Org Model: Users, Teams, Approvals, Spend, Context

How a company runs on open-glass: who can do what, who approves what, how money and tokens are controlled, and how the agent reaches files and drives without leaking them.

## 1. The core idea: every action is one policy decision

The agent never "just does" things. Every tool call, connection call, memory write, and model call goes through one question:

```
  (WHO)            (WHAT)                 (ON WHAT)              (HOW MUCH)
  principal   +    action class      +    resource          +    amount/risk
  user/team/role   read|write|send|       mercury__transfer      $ value, tokens,
                   spend|admin|memory     drive file, slot       recipients, scope
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  POLICY ENGINE  │  ← org rules (table below), budgets, membership
                        └────────┬────────┘
              ┌──────────────────┼──────────────────────┐
              ▼                  ▼                      ▼
           ALLOW         REQUIRE APPROVAL(by whom)     DENY (reason)
                                 │
                        eve pauses the session durably
                        → approver answers (chat / inbox / Slack / phone)
                        → resumes, or cancels
```

In eve this is the `approval` callback on every tool and connection (`docs/patterns/multi-tenant-approvals.md`), plus an **approval response policy** that restricts *who* may answer (`docs/tools/human-in-the-loop.md`). One adapter (`decideApproval(ctx)`) is shared by all tools. Lookup failures deny; they never allow. Executors re-check authorization (approval is a gate, not auth).

## 2. Org model

```
                         ┌──────────────────────────┐
                         │          ORG             │  (tenant; SSO domain; billing)
                         │ policies · budgets · audit│
                         └────────────┬─────────────┘
              ┌───────────────────────┼────────────────────────┐
              ▼                       ▼                        ▼
       ┌────────────┐          ┌────────────┐           ┌────────────┐
       │ TEAM: Eng  │          │ TEAM: Fin  │           │ TEAM: Sales│   (from IdP groups / SCIM)
       │ lead, budget│         │ lead, budget│          │ lead, budget│
       └─────┬──────┘          └─────┬──────┘           └─────┬──────┘
             ▼                       ▼                        ▼
         USERS (role: owner | admin | finance | lead | member | guest)
             │
             ├── own: profile memory, projects, sessions, files, personal connections (OAuth)
             ├── shared via team: team memory, team skills, team connections, team drive
             └── shared via org: company memory, Dojo skills, org connections (Mercury, Ramp)

  AGENTS act AS a user (delegated), never as a superuser.
  SCHEDULES act as the user who created them, or the org "app" principal with narrow grants.
```

| Entity | Fields that matter |
|--------|--------------------|
| org | id, sso domain, default policy set, monthly AI budget, money limits |
| team | id, lead_user_id, members, AI budget, approval chain |
| user | id, role, teams, manager_id (approver fallback), personal AI budget |
| grant | principal (user/team/role) → capability on resource (connection, slot, drive, skill) |
| policy_rule | match(action class, resource pattern, amount range, role/team) → allow/approve(by)/deny |
| budget | scope (user/team/org/project), period, soft limit, hard limit, spent (from ledger) |
| approval | id, session, tool, input snapshot, requested_by, required_approver, status, decided_by, reason |
| audit_event | every decision + every side effect, append-only |

## 3. How we decide: action classes + default policy

Each tool and connection operation is tagged with a **class**. Policy is written per class, not per tool, so new connectors work on day one.

| Class | Examples | Default |
|-------|----------|---------|
| `read` | search Drive, read Notion, list Linear issues, view balances | **allow** (with the user's own permissions) |
| `write.self` | create own doc, save project note, draft email | allow |
| `write.shared` | edit team doc, comment in channel, update CRM record | approve (self) |
| `send.external` | email a customer, post in a public Slack channel | **approve (self)**, a confirm card in chat |
| `spend.ai` | model calls | allow within budget; at the soft limit warn; at the hard limit deny or ask the lead to raise it |
| `spend.money` | Mercury transfer, Ramp card charge, buy a SaaS seat | ≤ role limit: approve (self); ≤ team limit: **approve (team lead)**; above: **approve (finance)**; above org max: deny |
| `memory.company` | propose a company fact | approve (domain owner or admin) |
| `memory.team` | save a team note | allow for members |
| `admin` | add connection, change policy, invite user | admin only, always approve |
| `destructive` | delete files, revoke access, close accounts | approve (owner of the resource) + reason |

Precedence: explicit deny > exact resource rule > class rule > org default (deny).

```ts
// agent/lib/policy.ts (sketch)
decide({ principal, toolName, cls, input }) →
  membership ok?            else deny
  rule = matchExact(toolName) ?? matchClass(cls) ?? orgDefault
  if cls === "spend.money": route by input.amount vs role/team/org limits
  if cls === "spend.ai":    check ledger vs budgets
  return allow | { approve: approverId(s) } | { deny: reason }
```

## 4. Approval routing

```
tool call ─▶ decide() ─▶ require approval(by X)
                              │
              ┌───────────────┼──────────────────────────┐
              ▼               ▼                          ▼
        X = self         X = team lead / finance      X = admin
        confirm card     approver inbox + Slack DM    admin console
        in chat          + push to phone
              │               │                          │
              └───────────────┴─────────┬────────────────┘
                                        ▼
                     eve approval response policy checks the responder is X
                     (wrong person → stays pending)
                                        ▼
                   approved → executor re-checks auth → runs with idempotency key
                   denied/expired → model told why, picks another path
                                        ▼
                                 audit_event (who, what, input, outcome)
```

The session waits durably for days if needed (Workflow SDK), at zero compute.

## 5. Spend: two ledgers, one control plane

```
                 ┌──────────────── AI SPEND ────────────────┐
 every model ──▶ │ Gateway (Vercel AI Gateway or LiteLLM)    │
 call            │ tags: org, team, user, project, session   │──▶ usage ledger
                 │ router picks model (cost/quality)         │      (tokens, $)
                 └──────────────────────────────────────────┘          │
                         ▲ pre-call budget check ◀─────────────────────┤
                         │                                             ▼
                         │                               live meter (per project/user)
                         │                               soft limit → warn
                         │                               hard limit → deny or ask lead

                 ┌──────────────── MONEY SPEND ─────────────┐
 agent wants ──▶ │ connections: Mercury (bank), Ramp/Brex   │
 to pay          │ (cards), Stripe, vendors                 │
                 │ class spend.money → threshold routing    │──▶ money ledger (mirrors
                 │ user's own delegated OAuth; never exceeds│     bank/card txns)
                 │ what that user can do in the bank/card UI│
                 └──────────────────────────────────────────┘
```

- **AI budgets (Vercel AI Gateway, checked 2026-10-14):** budgets exist for team, project, API key, and "user", but "user" means a *Vercel account member*, not our employees. So:
  - **Per-employee cap:** mint one gateway API key per employee and put a budget on the key. The gateway enforces it natively (HTTP 402 `quota_for_entity_exceeded`).
  - **Per-team / per-project cap:** not native. We tag every call (`ai-reporting-user`, `ai-reporting-tags: team:eng,project:x`), keep our own usage ledger, and check it before each call.
  - Budgets are **soft caps** (the request that crosses the limit still finishes), and BYOK spend is not counted.
  - Self-host alternative: LiteLLM has native user, team, key, and end-customer budgets, with a pre-call cost reservation (closer to a hard cap). It needs Postgres + Redis.
- **Money:** prefer **delegated per-user credentials** (Ramp's MCP respects each user's existing permissions), so the agent can never exceed the human. Org-level credentials (e.g. a Mercury API key) are only used behind `spend.money` approval with hard caps and idempotency keys.
- **Agent cards:** for purchases, issue a single-use or merchant-locked virtual card (Ramp Agent Cards) instead of exposing account access.

## 6. Context: files, drives, docs

```
            ┌──────────── WHERE CONTEXT COMES FROM ─────────────┐
            │                                                    │
 personal   │  user's OAuth → Drive, Gmail, Notion, Slack, Cal   │  agent sees exactly
            │  (eve dynamic connections per session)             │  what the user sees
            │                                                    │
 team       │  team-owned connection (shared drive, team Notion) │  members only
            │  credential held by team, scope = team             │
            │                                                    │
 org        │  org connections (wiki, Snowflake read-only,       │  everyone, read
            │  Mercury balances, policies)                       │
            │                                                    │
 workspace  │  files the agent creates → stored by scope:        │  user | project | team
            │  user / project / team (artifact store)            │
            └────────────────────────────────────────────────────┘
```

Rules:
1. **No superuser service accounts for reading.** Personal context always uses the user's own token, so permissions come from the source system.
2. **Memory never widens access.** A fact learned from a private doc goes to *that user's* memory only. Promoting it to team or company requires a proposal and approval, and the agent shows the source.
3. **Revocation cascades.** Disconnecting Drive hides Drive-derived memories and stops the related schedules.
4. **Sessions are owned.** Only the owner, and people they explicitly share with (multiplayer), can read or continue a session. eve route auth checks ownership before `POST/GET /eve/v1/session/:id`.

## 7. What maps to eve

| Need | eve primitive |
|------|---------------|
| Identity, org, team on every turn | route auth → `ctx.session.auth.current` with attributes `{orgId, teamIds, role}` |
| Per-user connections (Drive, Notion...) | `defineDynamic` connections resolved at `session.started` from our credential store |
| Org/team credentials, never shown to the model | connection `headers`/`auth` as async functions of ctx (multi-tenant outbound auth) |
| Approvals | `approval: (ctx) => decideApproval(ctx)` on tools + connections; approval response policy for *who* answers |
| Durable waiting | sessions are Workflow SDK runs; pause costs nothing |
| Memory scopes | slots: `profile` [org,user], `team` [org,team], `company` [org] |
| Schedules / digests | `defineSchedule` (+ DB-driven dynamic schedules, the OpenInstinct pattern) |
| Model spend | model via gateway with tags; budget check in a pre-call hook |
| Slack approvals / bots | eve Slack channel |

## 8. Build order (after the memory skeleton)

1. Auth: dev users with `{orgId, teamIds, role}`, then OIDC.
2. `policy.ts` + `decideApproval` adapter + action-class tags on every tool. Audit log.
3. Approver inbox (web) + response policy (only the named approver can answer).
4. AI gateway with tags + usage ledger + per-user/team budgets + meter.
5. Team slot + team connections.
6. First money connector (Ramp MCP read-only → then card requests behind `spend.money`).
7. Slack approvals + phone push.
