import type { ActionClass } from "./policy";

/** MCP-style hints Composio puts in each tool's `tags` (readOnlyHint, destructiveHint, ...). */
export type ToolHints = readonly string[];

/**
 * Policy class of a Composio tool, from its hints when we have them, else the verb in its
 * slug (GMAIL_SEND_EMAIL, SLACK_LIST_CHANNELS, ...).
 *
 * Composio marks read-only and destructive tools, which settles most cases; slugs alone
 * misread SLACK_SEARCH_MESSAGES or LINEAR_LIST_COMMENTS as sends. Hints can't tell a draft
 * from a post (both are `createHint`), so anything else that changes state is
 * `write.shared`, which asks first: other people see Notion pages, Linear issues and Slack
 * reactions. Only drafts stay `write.self`. Money moves are `spend.money`, which `decide()`
 * denies without an amount.
 */
export function classifySlug(slug: string, hints?: ToolHints): ActionClass {
  const name = slug.toUpperCase();
  const has = (hint: string) => hints?.includes(hint) ?? false;
  if (has("readOnlyHint") && !has("destructiveHint")) return "read";
  if (/(PAY|PURCHASE|CHARGE|TRANSFER|CHECKOUT|REFUND)/.test(name)) return "spend.money";
  if (has("destructiveHint") || /(DELETE|REMOVE|TRASH|ARCHIVE|REVOKE|CANCEL|PERMANENT)/.test(name)) return "destructive";
  if (/(SEND|REPLY|POST|INVITE|SHARE|PUBLISH|COMMENT|FORWARD|CREATE_EVENT|MESSAGE)/.test(name)) return "send.external";
  if (/DRAFT/.test(name)) return "write.self";
  const writes = /(CREATE|UPDATE|ADD|EDIT|PATCH|INSERT|UPLOAD|MOVE|RENAME|SET|CLEAR|MUTATION|WATCH)/.test(name);
  if (hints === undefined && !writes && /(GET|LIST|FETCH|SEARCH|READ|FIND|QUERY|RETRIEVE|DOWNLOAD)/.test(name)) return "read";
  return "write.shared";
}

const RANK: readonly ActionClass[] = ["read", "write.self", "write.shared", "send.external", "destructive", "spend.money"];

/** Slugs a Composio router meta-tool will run, from the `tool_slug` values in its input. */
export function slugsOf(toolInput: unknown): string[] {
  return [...JSON.stringify(toolInput ?? {}).matchAll(/"tool_slug"\s*:\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]!);
}

/**
 * Composio's tool router exposes meta-tools (COMPOSIO_MULTI_EXECUTE_TOOL, ...) whose real
 * targets are `tool_slug` values inside the input; classify by the riskiest one. The
 * workbench and bash helpers run arbitrary code that can call any tool, so they ask first.
 * Router helpers that only search or manage connections are reads.
 */
export function classifyCall(
  toolName: string,
  toolInput: unknown,
  hintsOf: (slug: string) => ToolHints | undefined = () => undefined,
): ActionClass {
  if (/^(composio__)?COMPOSIO_(REMOTE_WORKBENCH|REMOTE_BASH_TOOL)$/i.test(toolName)) return "send.external";
  if (!/EXECUTE/i.test(toolName)) {
    return /^(composio__)?COMPOSIO_/i.test(toolName) ? "read" : classifySlug(toolName, hintsOf(toolName));
  }
  const slugs = slugsOf(toolInput);
  if (slugs.length === 0) return "send.external";
  return slugs.map((s) => classifySlug(s, hintsOf(s))).reduce((a, b) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a), "read");
}
