import { defineTool } from "eve/tools";
import { z } from "zod";

import { callerOf, glassApproval } from "../lib/policy";
import { addMember, membersOf } from "../lib/sessions";

const inputSchema = z.object({
  email: z.string().email().describe("Login email of the colleague to add to this chat."),
});
type ShareInput = z.infer<typeof inputSchema>;

/**
 * Adds a colleague to the current chat: they can then read its full history,
 * post messages, and answer approvals they are eligible for. Same org only.
 * Asks the requester first, since it exposes the whole conversation.
 */
export default defineTool({
  description:
    "Add a colleague to this chat so they can read it and talk to you here. Use only when someone in the chat asks to share it or bring a person in.",
  inputSchema,
  label: { start: ({ email }) => `Share this chat with ${email}` },
  approval: glassApproval<ShareInput>("write.shared", {
    prompt: ({ input }) => `Share this chat, including its full history, with ${input.email}?`,
  }),
  async execute(input, ctx) {
    const caller = callerOf(ctx.session.auth.current);
    if (caller === null) throw new Error("An authenticated org user is required.");
    const problem = await addMember(ctx.session.id, caller, input.email.trim().toLowerCase());
    if (problem !== null) throw new Error(problem);
    return {
      shared: true,
      sessionId: ctx.session.id,
      members: (await membersOf(ctx.session.id)).map((m) => m.userId),
    };
  },
});
