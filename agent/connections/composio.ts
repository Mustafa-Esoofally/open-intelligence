import { Composio } from "@composio/core";
import { defineDynamic, defineMcpClientConnection } from "eve/connections";

import { classifyCall, slugsOf, type ToolHints } from "../lib/composio";
import { callerOf, decideApproval } from "../lib/policy";

// Tool hints are global per slug, so one cache serves every user. A failed lookup isn't
// cached; classifySlug falls back to the slug's verb for that call.
const hintCache = new Map<string, ToolHints>();

async function loadHints(composio: Composio, slugs: readonly string[]): Promise<void> {
  await Promise.all(
    slugs
      .filter((slug) => !hintCache.has(slug))
      .map(async (slug) => {
        try {
          const tool = await composio.tools.getRawComposioToolBySlug(slug);
          hintCache.set(slug, (tool.tags ?? []).filter((tag): tag is string => typeof tag === "string"));
        } catch {}
      }),
  );
}

// Slack, Gmail, Notion, GitHub, Linear, ... through Composio's tool router: one MCP endpoint
// per signed-in user, so each person connects their own accounts (Composio hosts the OAuth
// apps, which is what makes connecting 1-click). Off unless COMPOSIO_API_KEY is set.
export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      if (!process.env.COMPOSIO_API_KEY?.trim()) return null;
      const caller = callerOf(ctx.session.auth.current);
      if (caller === null) return null;

      // Composio user id = our user id (their email in dev), so connections follow the person.
      const composio = new Composio();
      const session = await composio.create(caller.userId, { mcp: true });
      return defineMcpClientConnection({
        url: session.mcp.url,
        description:
          "The user's connected apps via Composio: Slack, Gmail, Notion, GitHub, Linear, and 500+ more. Use it to search for a tool, connect an app (it returns a link for the user), and run tools.",
        headers: session.mcp.headers as Record<string, string>,
        instanceKey: caller.userId,
        // Same policy as our own tools: reads run, writes, sends and deletes ask, money is denied.
        approval: async (approvalCtx) => {
          await loadHints(composio, slugsOf(approvalCtx.toolInput));
          const cls = classifyCall(approvalCtx.toolName, approvalCtx.toolInput, (slug) => hintCache.get(slug));
          return decideApproval(cls, approvalCtx);
        },
      });
    },
  },
});
