import type { SessionAuthContext } from "eve/context";
import type {
  ApprovalContext,
  ApprovalPolicy,
  ApprovalResponseContext,
  ApprovalResponseDecision,
  ApprovalResponsePolicy,
  ApprovalStatus,
} from "eve/tools/approval";

/**
 * open-glass policy (docs/ORG.md section 3). Every tool call is one decision:
 *
 *   principal + action class (+ amount)  ->  allow | approve (by whom) | deny
 *
 * `decide()` is the pure policy. `glassApproval()` adapts it to eve's tool
 * `approval` field: a request-time `ApprovalStatus`, plus a response policy
 * that restricts WHO may answer the pending approval. Lookup failures deny;
 * approval is a gate, not authorization, so executors re-check with `decide()`.
 */

export const ROLES = ["owner", "admin", "finance", "lead", "member", "guest"] as const;
export type Role = (typeof ROLES)[number];

export type ActionClass =
  | "read"
  | "write.self"
  | "write.shared"
  | "send.external"
  | "spend.ai"
  | "spend.money"
  | "memory.team"
  | "memory.company"
  | "admin"
  | "destructive";

export type Approver = "self" | "lead" | "finance" | "admin";

export type Decision =
  | { readonly kind: "allow"; readonly reason: string }
  | { readonly kind: "approve"; readonly by: Approver; readonly reason: string }
  | { readonly kind: "deny"; readonly reason: string };

/** Verified org identity: what route auth stamped on the session principal. */
export interface Caller {
  readonly userId: string;
  readonly orgId: string;
  readonly teamIds: readonly string[];
  readonly role: Role;
}

/** USD thresholds for `spend.money`: self limit by role, then team lead, then finance, then deny. */
export const SPEND_LIMITS_USD = {
  self: { owner: 5_000, admin: 5_000, finance: 5_000, lead: 1_000, member: 100, guest: 0 },
  team: 5_000,
  orgMax: 25_000,
} as const;

/** Reads the caller from the verified principal. Never from model input. */
export function callerOf(auth: SessionAuthContext | null | undefined): Caller | null {
  if (!auth || auth.principalType !== "user") return null;
  const { orgId, role, teamIds } = auth.attributes;
  if (typeof orgId !== "string" || orgId.length === 0) return null;
  if (typeof role !== "string" || !(ROLES as readonly string[]).includes(role)) return null;
  return {
    userId: auth.principalId,
    orgId,
    teamIds: typeof teamIds === "string" ? [teamIds] : (teamIds ?? []),
    role: role as Role,
  };
}

export function decide(caller: Caller | null, cls: ActionClass, amountUsd?: number): Decision {
  if (caller === null) return deny("An authenticated org user is required.");
  if (caller.role === "guest" && cls !== "read") return deny("Guests can only read.");

  switch (cls) {
    case "read":
    case "write.self":
    case "memory.team":
      return allow(`${cls} is allowed for org members.`);
    case "write.shared":
      return approve("self", "Changes other people will see need the requester's confirmation.");
    case "spend.ai":
      // TODO: pre-call check against the usage ledger and per-user/team budgets.
      return allow("Within AI budget.");
    case "send.external":
      return approve("self", "External sends need the requester's confirmation.");
    case "destructive":
      return approve("self", "Destructive actions need the requester's confirmation.");
    case "memory.company":
      return approve("admin", "Company-wide facts need an admin's approval.");
    case "admin":
      return caller.role === "admin" || caller.role === "owner"
        ? approve("admin", "Admin actions are always confirmed by an admin.")
        : deny("Only admins can perform admin actions.");
    case "spend.money":
      return decideSpend(caller, amountUsd);
  }
}

function decideSpend(caller: Caller, amountUsd: number | undefined): Decision {
  if (amountUsd === undefined || !Number.isFinite(amountUsd) || amountUsd <= 0) {
    return deny("spend.money needs a positive amount.");
  }
  const { self, team, orgMax } = SPEND_LIMITS_USD;
  if (amountUsd > orgMax) {
    return deny(`$${usd(amountUsd)} exceeds the org maximum of $${usd(orgMax)}.`);
  }
  if (amountUsd <= self[caller.role]) {
    return approve("self", `Within your ${caller.role} limit of $${usd(self[caller.role])}.`);
  }
  if (amountUsd <= team) {
    return approve("lead", `Above your limit of $${usd(self[caller.role])}; a lead of your team must approve.`);
  }
  return approve("finance", `Above the team limit of $${usd(team)}; finance must approve.`);
}

/** eve `approval.request` adapter: policy decision -> `ApprovalStatus`. */
export function decideApproval<TInput>(
  cls: ActionClass,
  ctx: ApprovalContext<TInput>,
  amountUsd?: number,
): ApprovalStatus {
  const decision = decide(callerOf(ctx.session.auth.current), cls, amountUsd);
  switch (decision.kind) {
    case "allow":
      return { type: "approved", reason: decision.reason };
    case "approve":
      return "user-approval"; // eve pauses durably; `authorizeResponse` decides who may answer.
    case "deny":
      return { type: "denied", reason: decision.reason };
  }
}

/**
 * eve `approval.response` adapter: only the approver named by `decide()` may
 * settle the call. A rejected response leaves the request pending for an
 * eligible responder; the requester may always cancel their own request.
 */
export function authorizeResponse<TInput>(
  cls: ActionClass,
  ctx: ApprovalResponseContext<TInput>,
  amountUsd?: number,
): ApprovalResponseDecision {
  const requester = callerOf(ctx.request.principal);
  const responder = callerOf(ctx.response.principal);
  if (requester === null || responder === null || requester.orgId !== responder.orgId) {
    return rejected("Only members of the requesting org can respond.");
  }
  const decision = decide(requester, cls, amountUsd);
  if (decision.kind === "allow") return { status: "allowed" };
  if (decision.kind === "deny") return rejected(decision.reason);

  const isRequester = requester.userId === responder.userId;
  if (canApprove(decision.by, requester, responder) || (isRequester && ctx.response.decision === "cancel")) {
    return { status: "allowed" };
  }
  return rejected(
    `This call needs approval by ${describeApprover(decision.by, requester)}; ${responder.userId} (${responder.role}) cannot approve it.`,
  );
}

export interface GlassApprovalOptions<TInput> {
  /** Reads the USD amount from the validated tool input (for `spend.money`). */
  readonly amountUsd?: (input: TInput) => number | undefined;
  /** Human-readable prompt shown by approval UIs instead of `Approve <tool>?`. */
  readonly prompt?: (context: {
    readonly input: TInput;
    readonly toolName: string;
    readonly callId: string;
  }) => string;
}

/** Builds a tool's `approval` config from an action class: `approval: glassApproval("spend.money", ...)`. */
export function glassApproval<TInput>(cls: ActionClass, options: GlassApprovalOptions<TInput> = {}) {
  const amountOf = (input: unknown): number | undefined =>
    input === undefined ? undefined : options.amountUsd?.(input as TInput);
  const request: ApprovalPolicy<TInput> = (ctx) => decideApproval(cls, ctx, amountOf(ctx.toolInput));
  const response: ApprovalResponsePolicy<TInput> = (ctx) =>
    authorizeResponse(cls, ctx, amountOf(ctx.request.toolInput));
  return { request, response, prompt: options.prompt };
}

function canApprove(by: Approver, requester: Caller, responder: Caller): boolean {
  const isAdmin = responder.role === "admin" || responder.role === "owner";
  const other = responder.userId !== requester.userId; // four-eyes for money
  switch (by) {
    case "self":
      return responder.userId === requester.userId;
    case "admin":
      return isAdmin;
    case "finance":
      return other && (isAdmin || responder.role === "finance");
    case "lead":
      return (
        other &&
        (isAdmin ||
          (responder.role === "lead" && responder.teamIds.some((team) => requester.teamIds.includes(team))))
      );
  }
}

function describeApprover(by: Approver, requester: Caller): string {
  switch (by) {
    case "self":
      return `the requester (${requester.userId})`;
    case "lead":
      return `a lead of team ${requester.teamIds.join("/") || "(none)"} or an admin`;
    case "finance":
      return "finance or an admin";
    case "admin":
      return "an admin";
  }
}

const allow = (reason: string): Decision => ({ kind: "allow", reason });
const approve = (by: Approver, reason: string): Decision => ({ kind: "approve", by, reason });
const deny = (reason: string): Decision => ({ kind: "deny", reason });
const rejected = (reason: string): ApprovalResponseDecision => ({ status: "rejected", reason });
const usd = (amount: number): string => amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
