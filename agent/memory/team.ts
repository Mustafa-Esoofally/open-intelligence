import { defineMemory } from "eve/memory";

import { brainMemory } from "../lib/brain";
import { callerOf } from "../lib/policy";

// Slot `team`: one git repo per [org, team]; any member saves (memory.team).
export default defineMemory({
  description:
    "Shared memory for the current user's team: decisions, conventions, owners, and recurring context every teammate relies on. Not personal preferences, not company-wide policy.",
  provider: brainMemory({
    label: (scope) => `Team ${scope.value.at(-1)} memory (shared with everyone on the team)`,
    writes: "memory.team",
  }),
  // Fixed namespace: the default hashes the app root, which `eve dev` snapshots change on
  // every restart (and self-hosted installs change on every deploy path), orphaning memory.
  namespace: "open-glass/team",
  scope(ctx) {
    // v0: the user's first team is their primary team. Users without a team get no team memory.
    const caller = callerOf(ctx.session.auth.current);
    const teamId = caller?.teamIds[0];
    return caller !== null && teamId !== undefined ? [caller.orgId, teamId] : null;
  },
});
