# open-glass v0 skeleton: notes

Written 2026-10-13 against eve at vendor HEAD `de7a408e` (package version 0.79.0, which
`npm view eve` reports as the published `latest`). Every eve import below was checked in that
source tree; line numbers refer to `packages/eve/src` in the eve repo
unless a `docs/` path is given.

## File tree

```
fable-skel/
├── package.json                      eve ^0.79.0, ai, zod; scripts: dev/build/start/info/typecheck
├── tsconfig.json                     copy of eve's weather-agent fixture config (TS 5.9 and 7.0 both accept it)
├── .gitignore                        node_modules .data .eve .vercel .workflow-data .env*
├── README.md                         run steps, demo script for memory / policy / Dojo
├── NOTES.md                          this file
└── agent/
    ├── agent.ts                      defineAgent({ model: "anthropic/claude-sonnet-5" })
    ├── instructions.md               Glass persona; memory rules; approval rules; skills
    ├── channels/eve.ts               eveChannel({ auth: [devUsers(), localDev()] })
    ├── memory/profile.ts             fileMemory, scope [orgId, byPrincipal] (or byPrincipal alone)
    ├── memory/team.ts                fileMemory, scope [orgId, teamIds[0]]
    ├── memory/company.ts             fileMemory, scope orgId (one shared doc per org)
    ├── lib/disk-backend.ts           MemoryDocumentBackend on disk + memoryBackend() chooser
    ├── lib/dev-users.ts              3 fake users + devUsers() AuthFn (eve dev only)
    ├── lib/policy.ts                 action classes, decide(), decideApproval(), authorizeResponse(), glassApproval()
    ├── tools/request_spend.ts        stub spend.money tool, amount-threshold routing
    └── skills/save-as-skill/SKILL.md packaged skill: "save this as a skill" (Dojo loop)
```

16 files. Nothing outside the output directory was modified; `npm install` was not run.

## How it fits together

```
request ──▶ agent/channels/eve.ts  auth walk: devUsers() ─▶ localDev()
                │  principal { principalType:"user", principalId:"alice",
                │              attributes:{ orgId:"acme", teamIds:["eng"], role:"member" } }
                ▼
   turn.started: eve resolves + locks scopes, then recalls each slot
                │  profile  [acme, <principal>]   ──▶ .data/memory/<key>/MEMORY.md
                │  team     [acme, eng]           ──▶ .data/memory/<key>/MEMORY.md
                │  company  acme                  ──▶ .data/memory/<key>/MEMORY.md
                ▼
   model + tools: profile__save_memory, team__save_memory, company__save_memory (+ remove), request_spend
                │
   request_spend ──▶ approval.request = decideApproval("spend.money", ctx, amount)
                │        allow ─▶ runs   |   deny ─▶ model told why   |   approve ─▶ eve parks the turn
                │                                                             │
                │        approval.response = authorizeResponse(...)  ◀── someone answers
                │           wrong person ─▶ { rejected, reason } (stays pending)
                │           right person ─▶ { allowed } ─▶ execute() re-checks decide() ─▶ runs
                ▼
   turn.completed (no capture: fileMemory is model-driven only)
```

## Design decisions

1. **Runtime: eve, single root agent in `agent/`.** Slot names come from paths
   (`agent/memory/company.ts` is slot `company`, tools `company__save_memory` /
   `company__remove_memory`). No `name` fields anywhere.

2. **Memory = eve `fileMemory()` slots, nothing custom in the provider.** eve owns scope
   locking, recall (whole doc, 4k chars, stable id so re-recall supersedes), capture lifecycle and
   tool qualification. We only chose scopes and a storage backend. Slot `description` is prepended
   to the save/remove tool descriptions, so the `company` description does the "only durable
   company facts and corrections that apply to everyone" gating at the model level.

3. **Scopes come from verified auth only; `null` turns a slot off.**
   - `profile`: `byPrincipal(ctx)` (eve's helper: `null` for anonymous/runtime principals,
     `"local-dev"` for eve's synthetic dev principal, otherwise a JSON tuple of principal type,
     authenticator, issuer, id). When the principal carries an `orgId`, the scope is
     `[orgId, principal]` as in BRAIN.md section 3; otherwise the bare principal so plain
     `localDev()` sessions still get a profile.
   - `team`: `[orgId, teamIds[0]]`. v0 treats the first team as the primary team.
   - `company`: the org id string, i.e. a fixed scope string per tenant (`"acme"` in dev), so the
     whole org shares one document. It is `null` without an org principal rather than a literal
     constant so an unauthenticated or runtime caller can never read or write company memory.
   - `visibility` is left at the default `"scope"`.

4. **Local disk backend (`agent/lib/disk-backend.ts`)** implements eve's `MemoryDocumentBackend`
   seam (`read`/`write`, optimistic `expectedVersion`, `MemoryDocumentConflictError`):
   - path `<root>/<scopeKey>/MEMORY.md`, root `./.data/memory` or `GLASS_DATA_DIR`. eve's scope
     keys are `memscope1_<base64url sha256>` so they are path-safe; any other key is
     percent-encoded as a fallback.
   - version = `sha256_<base64url digest of content>`; `expectedVersion === null` is create-only
     and conflicts when the file exists; a stale version conflicts and `fileMemory()` re-reads and
     retries (up to 8 times, its own logic).
   - per-key promise queue serializes read-compare-write inside the process; writes go to a temp
     file then `rename` so a crash never leaves a torn document.
   - `memoryBackend()` returns the disk backend only when `process.env.VERCEL` is unset, so on
     Vercel `fileMemory()` keeps eve's private Blob default (`EVE_MEMORY_BLOB_*`).
   - `eve dev` spawns the local server with `cwd: appRoot` (`cli/dev/local-server-process.ts:106`),
     which is why `process.cwd()` is a safe default for the data directory.

5. **Dev auth: three fake users with org attributes, eve dev only.** `devUsers()` is a custom
   `AuthFn` placed before `localDev()`. It is gated on `process.env.EVE_DEV === "1"`, the same
   probe `localDev()` uses (`internal/application/dev-environment.ts:7`), so it can never
   authenticate production traffic. The user is chosen by the `x-glass-user` header, else
   `GLASS_DEV_USER`, else `alice`. It returns a `user` principal with
   `attributes { orgId, teamIds, role, name }`, which is exactly what ORG.md section 7 says route
   auth must stamp. Unknown names throw `UnauthenticatedError` (401). Prototype keys such as
   `constructor` are rejected via `Object.hasOwn`.
   - Users: alice (member, eng), bob (lead, eng), carol (finance, fin).
   - Because `devUsers()` answers first, each fake user gets an isolated `profile` scope. If you
     delete it and keep only `localDev()`, `byPrincipal` returns the shared `"local-dev"` scope for
     everyone and the `team`/`company` slots turn off (no org attributes).
   - Adding real auth later: put an `AuthFn` that verifies your SSO/OIDC session ahead of these
     and return the same attribute shape; keep `principalId` stable and add `issuer` once more than
     one identity provider exists (both feed `byPrincipal` and eve's connection token cache). The
     default eve channel also includes `vercelOidc()`; add it back ahead of `localDev()` for Vercel.

6. **Policy (`agent/lib/policy.ts`) is pure and shared.** `decide(caller, class, amount)` returns
   `allow | approve(by) | deny` per ORG.md section 3; lookup failures deny. Two adapters map it
   onto eve's approval contract:
   - `decideApproval()` (request time): allow -> `{ type: "approved", reason }`,
     approve -> `"user-approval"`, deny -> `{ type: "denied", reason }`.
   - `authorizeResponse()` (response time): recomputes the decision from the captured
     `request.principal` and the submitted `response.principal`, and only lets the named approver
     settle the call. `self` = the requester; `lead` = a different person who is a lead of one of
     the requester's teams, or an admin/owner; `finance` = a different person with role finance, or
     an admin/owner; `admin` = admin/owner. The requester may always `cancel`. Everyone else gets
     `{ status: "rejected", reason }`, which eve treats as "leave it pending" (see below).
   - `glassApproval(cls, { amountUsd, prompt })` packages both plus the human-readable prompt into
     the object form of a tool's `approval` field.
   - Thresholds (`SPEND_LIMITS_USD`): self limit by role (member 100, lead 1000, finance/admin/owner
     5000), team 5000, org max 25000. Above org max is a deny, not an approval.

7. **`request_spend` is a stub** that records a request and moves no money. `execute` re-derives the
   caller and re-runs `decide()` because approval is a gate, not authorization (membership can
   change while a session is parked). It returns an idempotency key
   (`spend_<sessionId>_<callId>`) for the eventual connector, since eve may re-run an interrupted
   step. `label.start` gives channels a readable activity line.

8. **Skill = the Dojo idea in one file.** `agent/skills/save-as-skill/SKILL.md` is a packaged skill
   (directory + `SKILL.md`, `description` frontmatter is mandatory for the packaged form). It tells
   the agent how to turn a procedure that just worked into a new `agent/skills/<name>/SKILL.md`
   via eve's bundled local self-modification extension (mounted by default in `eve dev`).

9. **Instructions** keep the eve-recommended memory trust text (memories are data, not
   instructions; never save secrets; announce saves/removes) and add: confirm wording before a
   `company` save, prefer fresh sources, do not route around approvals.

10. **Versions.** `eve ^0.79.0` (published `latest`), `ai ^7.0.137` (eve's peer catalog range),
    `zod ^4.5.4` (catalog), `@types/node ^24.13.3`, `typescript ^5.9.3` (the local typecheck ran on
    5.9.3; eve's own template and fixtures use 7.0.2 with the same tsconfig). Node >= 24 is eve's
    `engines` requirement.

## How the approval response policy restricts who can approve

By default eve lets only the person whose turn requested a call approve or cancel it
(`docs/tools/human-in-the-loop.md`, "Authorizing approval responses"). A tool with a `response`
policy replaces that default entirely. eve calls it for both `approve` and `cancel` with:

- `request.principal`: the authenticated caller whose turn made the call, captured when the
  approval was requested (stable while other people continue the session; `null` if anonymous);
- `response.principal`: the authenticated principal submitting the answer, including its
  `attributes`, so `callerOf()` can read `orgId`, `teamIds`, `role` for the responder too;
- `session.initiator`, `session.id`, `session.turn`, and `auth.getToken/requireAuth`.

Returning `{ status: "rejected", reason }` keeps the request pending and the turn held; the stream
emits `approval.candidate` with `outcome: "pending"` then `"rejected"` plus the reason, then
`turn.waiting` for the same turn. Returning `{ status: "allowed" }` settles it. This is the exact
mechanism ORG.md section 4 describes ("wrong person -> stays pending"). Two consequences for v0:

- the identity of the required approver is only communicated through the rejection reason
  (eve's `"user-approval"` status cannot carry "by whom"); the approver inbox (ORG.md build order
  step 3) should compute `decide()` for display;
- another user must answer through the HTTP API in v0 (`POST /eve/v1/session/<id>` with
  `{"inputResponses":[{"requestId":"...","optionId":"approve"}]}` and their `x-glass-user`
  header); the TUI only drives the current user's own session.

Approval is consent only: eve runs the approved call with the requesting user's identity and
credentials, never the approver's.

## eve APIs used, with the source each was verified in

| Import | Names | Verified in | Notes |
| --- | --- | --- | --- |
| `eve` | `defineAgent` | `index.ts:1` re-exports `public/index.ts`; `public/definitions/agent.ts:109`; `model: string \| LanguageModel` at `shared/agent-definition.ts:87` | `name` must not be authored |
| `eve/memory` | `defineMemory`, `MemoryScopeContext` | `public/memory/index.ts:164` (defineMemory), `:32` (scope ctx), `:30` resolver result `string \| readonly string[] \| null`, `:146` definition fields | exported via `package.json` `"./memory"` |
| `eve/memory/file` | `fileMemory`, `MemoryDocumentBackend`, `MemoryDocument`, `MemoryDocumentConflictError` | `public/memory/file/index.ts`; `provider.ts:47` (`options.backend ?? defaultFileMemoryBackend()`), `:16-20` limits (4k recall, 2KB entry, 64KB doc, 8 conflict retries), `:157-194` retry loop; `backend.ts:30` interface, `:36` error with static `is()` | `package.json` `"./memory/file"` |
| `eve/memory/scope` | `byPrincipal` | `public/memory/scope.ts:4` -> `shared/principal-scope.ts:6-15` | null for `anonymous`/`runtime`, `"local-dev"` for local-dev, JSON tuple otherwise |
| (default backend) | - | `public/memory/file/backends/default.ts:36-50` | Vercel -> Blob (`EVE_MEMORY_BLOB_*`/`BLOB_*`), `EVE_DEV=1` -> process memory, else throws asking for a backend |
| (scope key format) | - | `shared/memory-state.ts:59-90` | `memscope1_` + base64url sha256 of a composite of namespace and scope digests |
| `eve/channels/eve` | `eveChannel` | `public/channels/eve.ts:1` re-exports `eve-channel/index.ts:113`; input type `eve-channel/types.ts:97-103` (`auth: AuthFn<Request> \| readonly AuthFn<Request>[]`) | replaces the default channel source (`[vercelOidc(), localDev(), placeholderAuth()]`) |
| `eve/channels/auth` | `localDev`, `AuthFn`, `UnauthenticatedError` | `public/channels/auth.ts:835` (localDev, uses `isEveDevEnvironment()` or `VERCEL`+`VERCEL_ENV=development`), `:531` (AuthFn returns `AuthResult \| null \| undefined`), `:487` (UnauthenticatedError, options `{ code?, message?, challenges? }` from `:387-408`) | `EVE_DEV` flag: `internal/application/dev-environment.ts:3-9`; set by the dev server spawn at `cli/dev/local-server-process.ts:106-112` |
| `eve/context` | `SessionAuthContext` (type) | `public/context/index.ts:13-20` -> `channel/types.ts:142-149` | `attributes: Readonly<Record<string, string \| readonly string[]>>` |
| `eve/tools` | `defineTool` | `public/tools/index.ts:7`; overloads `tools/definition.ts:293-380` (`inputSchema` Standard Schema, `approval`, `label`); `ToolContext` `:178-219` (`session`, `callId`, `abortSignal`); `ToolLabelDefinition.start(input)` `:44-51` | `SessionContext.session.{id, auth, turn}` at `context/session-context.ts:21-38` |
| `eve/tools/approval` | types `ApprovalContext`, `ApprovalPolicy`, `ApprovalStatus`, `ApprovalResponseContext`, `ApprovalResponseDecision`, `ApprovalResponsePolicy` | `public/tools/approval/index.ts:6-26` -> `approval/definition.ts`: ApprovalContext `:27`, ApprovalStatus `:69`, ApprovalPolicy `:81`, ApprovalRequest (`principal`, `toolInput`) `:89`, ApprovalResponse `:115`, ApprovalResponseContext `:122`, ApprovalResponseDecision `:132`, ApprovalResponsePolicy `:137`, ToolApprovalConfiguration with `prompt` `:149-152` | `ApprovalPrompt` and `ToolApprovalConfiguration` exist in 0.79.0 but not in 0.71.0, so `glassApproval()` returns a structural object instead of naming them |
| `agent/skills/<name>/SKILL.md` | - | `docs/skills.mdx` ("Markdown vs defineSkill": packaged skill needs `description` frontmatter; name rules) | loaded with `eve__skill` |
| `agent/instructions.md` | - | `docs/instructions.mdx` | system-role prompt |
| agent file slots | `channels/ memory/ lib/ tools/ skills/` | `docs/reference/agent-files.md` | `lib/` is import-only |
| self-modification in dev | - | `docs/guides/self-modification.md` | bundled `eve/self-modification/local`, mounted by `eve dev` by default |
| HTTP answer to an approval | `inputResponses` | `docs/concepts/sessions-runs-and-streaming.md:210-215` | `{"inputResponses":[{"requestId":"req_A","optionId":"approve"}]}` |
| `eve remote connect -H` | - | `docs/reference/cli.md:325-331` | custom header per attached TUI |

Reference apps read for shape only: `apps/templates/eve-chat-template/agent/{agent.ts,memory/profile.ts,instructions.md,channels/eve.ts}` and `vendor/OpenInstinct/agent/{memory/profile.ts,lib/profile-memory.ts,lib/principal-scope.ts}`.

## Verification performed (nothing installed, nothing run inside the output directory)

- `tsc --noEmit` with eve 0.71.0 `.d.ts` and real `zod`/`ai`/`@types/node` (reused from
  `~/Developer/open-bot/node_modules` via a symlink in a scratch harness): clean.
- `tsc --noEmit` with `paths` mapped to the eve 0.79.0 vendor **source** plus
  `customConditions: ["eve-source"]`: zero diagnostics in the skeleton's files (the remaining
  diagnostics are inside vendor files that need build artifacts, e.g. `#compiled/jose`). A probe
  file importing 0.79-only names (`ToolApprovalConfiguration`, `ApprovalPrompt`) typechecked in that
  harness and failed in the 0.71 harness, which proves the mapping resolved the source.
- Runtime smoke test with Node 26 type stripping against the installed eve 0.71.0 runtime:
  disk backend (null read, create-only, stale-version conflict, concurrent writers with one winner,
  abort signal, path-safe odd keys, no temp files left), policy (`callerOf`, every `spend.money`
  threshold, `decideApproval`, `authorizeResponse` for self/lead/wrong-team lead/finance/other
  org/null requester/cancel, `glassApproval`), and `devUsers()` (inactive without `EVE_DEV`,
  header, env default, unknown and prototype names rejected). All assertions passed.
- Not run: `npm install`, `eve dev`, `eve info`, `eve build`.

## Open questions and risks

1. **Never booted under `eve dev`.** Discovery and bundling of these files is assumed from docs:
   extensionless relative imports (`../lib/policy`) follow the documented style, but the first
   `eve info` / `eve dev` run is the real test. Also unverified: how the dev TUI renders an
   approval whose response was rejected by policy (the stream contract is documented; the TUI copy
   is not).
2. **No approver inbox.** Cross-user approvals work only through the raw HTTP API in v0; the
   required approver is visible only in the rejection reason. ORG.md step 3.
3. **Company memory writes are not approval-gated.** `company__save_memory` is a provider tool
   from `fileMemory()`; v0 relies on the slot description and instructions. ORG.md wants
   `memory.company -> approve(admin)`. Options: a small custom provider whose `save` tool sets
   `approval: glassApproval("memory.company")`, or eve's documented `agent/tools/<slot>.ts`
   wrapper replacement (`docs/memory/overview.mdx`, "Tell the model how to use memory"), whose
   exact semantics I did not verify.
4. **`team` slot picks `teamIds[0]`.** Multi-team users need a session/channel selector (eve's
   scope resolver receives `channel.metadata`, which is the natural place).
5. **Disk backend is single-process.** Two servers on one `.data` could race between
   read-compare and rename. Fine for `eve dev`; use Blob or a database backend for anything shared.
   Self-hosted `eve start` uses whatever cwd it is started from: set `GLASS_DATA_DIR`.
6. **Deployment fails closed on purpose.** `agent/channels/eve.ts` has no production
   authenticator; add OIDC/SSO (and `vercelOidc()` on Vercel) ahead of `localDev()`.
7. **Scheduled runs get no memory and are denied by policy.** The app principal is
   `principalType: "runtime"`, so `byPrincipal` and `callerOf` both return `null`. The nightly dream
   workflow (BRAIN.md section 5) must run with explicit user principals or its own scope resolver.
8. **`prompt` on approval config** is in 0.79.0 (`approval/definition.ts:149`) but absent in
   0.71.0; with an older eve it is silently ignored.
9. **Model string** `anthropic/claude-sonnet-5` routes through Vercel AI Gateway; `/login` in the
   TUI can rewrite `agent.ts` to a direct provider helper (`eve/models/anthropic`).
10. **`ai` peer range.** eve pins `ai` via its catalog (`^7.0.137`); the template's `.npmrc`
    `legacy-peer-deps=true` is only needed together with `@vercel/connect`, which v0 does not use.
11. **Spend thresholds and roles are constants** in `policy.ts`; ORG.md's `policy_rule`,
    `budget`, `grant`, and `audit_event` tables are the next step (step 2 of the build order), along
    with the `spend.ai` ledger check that is currently a TODO returning allow.
