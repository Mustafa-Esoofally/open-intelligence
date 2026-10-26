import { defineTool } from "eve/tools";
import { z } from "zod";

import { callerOf, decide, glassApproval } from "../lib/policy";

const inputSchema = z.object({
  amountUsd: z.number().positive().describe("Amount in US dollars."),
  vendor: z.string().min(1).describe("Who gets paid."),
  purpose: z.string().min(1).describe("What it is for, in one sentence."),
});
type SpendInput = z.infer<typeof inputSchema>;

/**
 * Stub `spend.money` action: records a spend request and moves no money.
 * Routing comes from agent/lib/policy.ts: within the caller's role limit the
 * caller confirms; above it a lead of their team; above the team limit
 * finance; above the org maximum the call is denied.
 */
export default defineTool({
  description:
    "Request a company spend (card charge, vendor payment, SaaS seat). Use only when the user asks to buy or pay for something.",
  inputSchema,
  label: {
    start: ({ amountUsd, vendor }) => `Request $${amountUsd.toFixed(2)} spend at ${vendor}`,
  },
  approval: glassApproval<SpendInput>("spend.money", {
    amountUsd: (input) => input.amountUsd,
    prompt: ({ input }) =>
      `Approve $${input.amountUsd.toFixed(2)} to ${input.vendor} for "${input.purpose}"?`,
  }),
  async execute(input, ctx) {
    // Approval is a gate, not authorization: re-derive the caller and re-check
    // policy right before the side effect (membership can change while parked).
    const caller = callerOf(ctx.session.auth.current);
    if (caller === null) throw new Error("An authenticated org user is required.");
    const decision = decide(caller, "spend.money", input.amountUsd);
    if (decision.kind === "deny") throw new Error(decision.reason);

    return {
      status: "recorded" as const,
      // Idempotency key for the real connector later (eve may replay interrupted steps).
      requestId: `spend_${ctx.session.id}_${ctx.callId}`,
      orgId: caller.orgId,
      requestedBy: caller.userId,
      approvalRoute: decision.kind === "approve" ? decision.by : "none",
      ...input,
      note: "v0 stub: nothing was charged. Put a Ramp/Mercury connection behind this class next.",
    };
  },
});
