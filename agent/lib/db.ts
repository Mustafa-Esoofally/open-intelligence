import pg from "pg";

import type { Role } from "./policy";

/**
 * Postgres connection for org data and memory. `DATABASE_URL` comes from
 * `.env.local` (eve dev loads it); see docker-compose.yml for the local server.
 */
let pool: pg.Pool | undefined;

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function db(): pg.Pool {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not set. Run `docker compose up -d && npm run db:migrate` (see README.md).");
  }
  pool ??= new pg.Pool({ connectionString: url, max: 5 });
  return pool;
}

export interface OrgUser {
  readonly id: string;
  readonly orgId: string;
  readonly role: Role;
  readonly teamIds: readonly string[];
}

/** Loads one user with their teams, primary team first. `null` when unknown. */
export async function findUser(id: string): Promise<OrgUser | null> {
  const { rows } = await db().query<{ id: string; org_id: string; role: Role; team_ids: string[] }>(
    `SELECT u.id, u.org_id, u.role,
            coalesce(array_agg(m.team_id ORDER BY m.position, m.team_id) FILTER (WHERE m.team_id IS NOT NULL), '{}') AS team_ids
       FROM users u
       LEFT JOIN team_members m ON m.user_id = u.id AND m.org_id = u.org_id
      WHERE u.id = $1
      GROUP BY u.id`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : { id: row.id, orgId: row.org_id, role: row.role, teamIds: row.team_ids };
}
