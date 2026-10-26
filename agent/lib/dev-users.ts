import { type AuthFn, UnauthenticatedError } from "eve/channels/auth";

import { findUser } from "./db";

/** Who you are when no header or env var says otherwise. Users live in Postgres (db/seed.sql). */
export const DEFAULT_DEV_USER = "admin@example.com";

export const DEV_USER_HEADER = "x-glass-user";

/**
 * Route auth for `eve dev` only. It uses the same `EVE_DEV=1` probe as eve's
 * `localDev()`, so a deployment never accepts it. The user id (their email)
 * comes from the `x-glass-user` request header, else `GLASS_DEV_USER`, else
 * `DEFAULT_DEV_USER`, and must exist in the `users` table. The returned
 * principal carries the org identity every memory scope and policy decision
 * reads: `attributes.{orgId, teamIds, role}`.
 */
export function devUsers(): AuthFn<Request> {
  return async (request) => {
    if (process.env.EVE_DEV !== "1") return null;
    const name =
      request.headers.get(DEV_USER_HEADER)?.trim() || process.env.GLASS_DEV_USER?.trim() || DEFAULT_DEV_USER;
    const user = await findUser(name);
    if (user === null) {
      throw new UnauthenticatedError({
        code: "unknown_dev_user",
        message: `Unknown dev user "${name}". Add them to the users table (db/seed.sql) and run npm run db:migrate.`,
      });
    }
    return {
      attributes: { orgId: user.orgId, teamIds: user.teamIds, role: user.role, name },
      authenticator: "glass-dev",
      principalId: user.id,
      principalType: "user",
    };
  };
}
