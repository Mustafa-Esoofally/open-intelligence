import { defineMemory } from "eve/memory";
import { byPrincipal } from "eve/memory/scope";

import { brainMemory } from "../lib/brain";
import { callerOf } from "../lib/policy";

// Slot `profile`: one git repo per person. Tools: profile__save, __forget, __read, __history.
export default defineMemory({
  description:
    "Private memory about the current user only: their role, team, projects, tools, and how they like answers. Never company-wide facts.",
  provider: brainMemory({ label: (scope) => `Private memory of ${scope.value.at(-1)} (only they see it)`, writes: "write.self" }),
  // Fixed namespace: the default hashes the app root, which `eve dev` snapshots change on
  // every restart (and self-hosted installs change on every deploy path), orphaning memory.
  namespace: "open-glass/profile",
  scope(ctx) {
    // `byPrincipal` is null for anonymous and runtime principals (slot off) and
    // `local-dev` for eve's synthetic local principal.
    const principal = byPrincipal(ctx);
    if (principal === null) return null;
    const caller = callerOf(ctx.session.auth.current);
    return caller === null ? principal : [caller.orgId, caller.userId];
  },
});
