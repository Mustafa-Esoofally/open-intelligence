import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyCall, classifySlug } from "./composio.ts";

test("classifySlug without hints maps tool verbs to policy classes, failing closed", () => {
  assert.equal(classifySlug("GMAIL_FETCH_EMAILS"), "read");
  assert.equal(classifySlug("SLACK_LIST_ALL_CHANNELS"), "read");
  assert.equal(classifySlug("GMAIL_CREATE_EMAIL_DRAFT"), "write.self");
  assert.equal(classifySlug("NOTION_CREATE_NOTION_PAGE"), "write.shared");
  assert.equal(classifySlug("GMAIL_SEND_EMAIL"), "send.external");
  assert.equal(classifySlug("SLACK_SEND_MESSAGE"), "send.external");
  assert.equal(classifySlug("GITHUB_DELETE_A_REPOSITORY"), "destructive");
  assert.equal(classifySlug("STRIPE_CREATE_REFUND"), "spend.money");
  assert.equal(classifySlug("NOTION_SOMETHING_ODD"), "write.shared");
  assert.equal(classifySlug("SLACK_CREATE_SLACK_LIST"), "write.shared");
  assert.equal(classifySlug("LINEAR_RUN_QUERY_OR_MUTATION"), "write.shared");
});

test("classifySlug trusts Composio's hints over the slug's verb", () => {
  const ro = ["readOnlyHint", "openWorldHint"];
  assert.equal(classifySlug("SLACK_SEARCH_MESSAGES", ro), "read");
  assert.equal(classifySlug("LINEAR_LIST_COMMENTS", ro), "read");
  assert.equal(classifySlug("STRIPE_LIST_CHARGES", ro), "read");
  assert.equal(classifySlug("NOTION_DELETE_VIEW", ["destructiveHint"]), "destructive");
  assert.equal(classifySlug("LINEAR_CREATE_LINEAR_ISSUE", ["createHint"]), "write.shared");
  assert.equal(classifySlug("SLACK_ADD_REACTION_TO_AN_ITEM", ["createHint"]), "write.shared");
  assert.equal(classifySlug("SLACK_CHAT_POST_MESSAGE", ["createHint"]), "send.external");
  assert.equal(classifySlug("GMAIL_CREATE_EMAIL_DRAFT", ["createHint"]), "write.self");
  // Unhinted listing tools with hints present but not read-only ask rather than run.
  assert.equal(classifySlug("ODD_LIST_THINGS", ["updateHint"]), "write.shared");
});

test("classifyCall takes the riskiest slug inside router meta-tools", () => {
  assert.equal(classifyCall("COMPOSIO_SEARCH_TOOLS", { use_case: "send an email" }), "read");
  assert.equal(
    classifyCall("COMPOSIO_MULTI_EXECUTE_TOOL", {
      tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }, { tool_slug: "GMAIL_SEND_EMAIL" }],
    }),
    "send.external",
  );
  assert.equal(
    classifyCall("composio__COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "SLACK_SEARCH_MESSAGES" }] }, () => ["readOnlyHint"]),
    "read",
  );
  assert.equal(classifyCall("COMPOSIO_MULTI_EXECUTE_TOOL", {}), "send.external");
  assert.equal(classifyCall("COMPOSIO_REMOTE_WORKBENCH", { code_to_execute: "run_composio_tool('GMAIL_SEND_EMAIL', {})" }), "send.external");
  assert.equal(classifyCall("COMPOSIO_REMOTE_BASH_TOOL", { command: "ls" }), "send.external");
});
