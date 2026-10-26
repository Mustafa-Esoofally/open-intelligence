import { defineMemory } from "eve/memory";

import { brainMemory } from "../lib/brain";
import { callerOf } from "../lib/policy";

// Slot `company`: ONE git repo for the whole org; saves wait for an admin (memory.company).
// The scope value is the org id ("acme" in dev), so every employee recalls the same repo.
export default defineMemory({
  description:
    "Company-wide memory shared with EVERYONE in the org. Save only durable company facts and corrections that apply to everyone, for example a policy, a definition, or a correction like 'exclude US companies that only have a UK office'. Never personal preferences, team-local notes, or current-task details. Confirm the wording with the user before saving.",
  provider: brainMemory({
    label: (scope) => `Company ${scope.value} memory (shared with everyone in the org; saves need an admin)`,
    writes: "memory.company",
  }),
  // Fixed namespace: the default hashes the app root, which `eve dev` snapshots change on
  // every restart (and self-hosted installs change on every deploy path), orphaning memory.
  namespace: "open-glass/company",
  scope(ctx) {
    const caller = callerOf(ctx.session.auth.current);
    return caller === null ? null : caller.orgId;
  },
});
