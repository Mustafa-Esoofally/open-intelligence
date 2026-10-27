# Try it

Hands-on walkthroughs of what works today. Start with the [quickstart](../README.md#quickstart).

## Use your own emails

Add them in `db/seed.local.sql` (gitignored) and re-run `npm run db:migrate`. You chat as
`admin@example.com` unless you set `GLASS_DEV_USER`.

To be a second person at the same time, attach another terminal to the running server:

```bash
npx eve remote connect --url http://localhost:2000 -H "x-glass-user: member@example.com"
```

## Connect apps

1. At [platform.composio.dev](https://platform.composio.dev), switch to **Platform**, open
   your project, then **API Keys → Create API Key**. Use the `ak_` key; the `ck_` key under
   account settings is for MCP clients.
2. `echo 'COMPOSIO_API_KEY=ak_...' >> .env.local` and restart `npm run dev`.
3. Ask "connect my Gmail". The agent replies with a link; open it and approve.

Then try "what's on my calendar tomorrow?" or "summarize my last 3 emails".

## Two people, one brain

```
member   "We freeze deploys on Fridays after noon ET. Remember that for the team."
agent    Saved to team memory (deploys).            → git commit by member

admin    (new chat) "Can I ship at 3pm Friday?"
agent    No. Deploys freeze Fridays after noon ET
         (team memory, added by member on 2026-10-23).

member   "Add to company memory: we don't sell to US companies with only a UK office."
agent    Company saves need an admin. Waiting for approval.
member   approves it themselves                     → rejected
admin    approves                                   → saved, still credited to member
```

Also try: say "I prefer terse answers", start a new chat with `/new`, and ask "what do you
know about me?".

## Shared chats

As the admin: "Bring `member@example.com` into this chat." The agent asks you to confirm,
since they will see the full history. The member finds the chat with
`curl -H "x-glass-user: member@example.com" http://localhost:2000/glass/v1/sessions` and joins it.

## Approvals

As the member, whose own spend limit is $100:

| Ask | What happens |
|---|---|
| "Request a $40 spend at Figma for a design seat." | The member confirms it |
| "Request a $300 spend at Datadog." | Needs a team lead or admin; the member's own approval is rejected |
| "Request a $9,000 spend at AWS." | Needs finance |
| "Request a $30,000 spend." | Denied, above the org maximum |

There is no approvals inbox yet, so the approver answers from inside the chat or through
the HTTP API with the request id from the session stream:

```bash
curl -X POST http://localhost:2000/eve/v1/session/<sessionId> \
  -H "x-glass-user: admin@example.com" -H "content-type: application/json" \
  -d '{"inputResponses":[{"requestId":"<requestId>","optionId":"approve"}]}'
```

## Skills

After the agent does something useful, say "save this as a skill".

## How the working parts behave

**Memory** lives under `.data/brain/` (`GLASS_BRAIN_DIR` to move it), in the
[Agent Memory Repo](https://github.com/AgentMemoryRepo) layout:

```
.data/brain/
  profile/acme/<email>/   private to that person         saves directly
  team/acme/eng/          shared with the team           any member saves
  company/acme/           shared with everyone           saves wait for an admin
    MEMORY.md             index of topics
    deploys.md            - Freeze deploys Fridays after noon ET [by: …; added: 2026-10-23; source: <chat>]
```

Each save is one commit authored by the person who taught it. Relevant topics are recalled
at the start of every turn as data, never as instructions, and secrets are refused before
they reach disk.

**Access.** eve authenticates every request but does not check whose chat it is.
`agent/channels/eve.ts` adds that: every chat route checks membership in Postgres (others
get a 404), the creator is recorded when a chat starts, and each message reaches the model
tagged with its sender.

**Policy.** Every tool call is classified, then `decide()` in `agent/lib/policy.ts` returns
allow, ask someone, or deny:

| Action | Rule |
|---|---|
| Reads, your own drafts, team memory | Run |
| Sends, deletes, changes others will see, code in the Composio workbench | The requester confirms |
| Company memory | An admin approves |
| Spend | By amount: you, then a team lead, then finance; denied above the org maximum |
| Payments through connected apps | Denied |

App tools are classified from Composio's read-only and destructive hints first, then from
the tool name (`agent/lib/composio.ts`). Who may answer an approval is enforced on the
server, not trusted to the UI.
