import { db } from "./db";
import type { Caller } from "./policy";

/**
 * Who belongs to which chat session (db/schema.sql `sessions`, `session_members`).
 * eve authenticates every route but lets any signed-in caller use any session id;
 * agent/channels/eve.ts checks `isMember` first so a chat is visible only to the
 * people in it, and the `share_session` tool adds people.
 */

/** Records a new session with its creator as the first member. */
export async function recordSession(sessionId: string, creator: Caller): Promise<void> {
  await db().query(
    `WITH s AS (
       INSERT INTO sessions (id, org_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
     )
     INSERT INTO session_members (session_id, user_id, added_by) VALUES ($1, $3, $3) ON CONFLICT DO NOTHING`,
    [sessionId, creator.orgId, creator.userId],
  );
}

export async function isMember(sessionId: string, caller: Caller): Promise<boolean> {
  const { rowCount } = await db().query(
    `SELECT 1 FROM session_members m JOIN sessions s ON s.id = m.session_id
      WHERE m.session_id = $1 AND m.user_id = $2 AND s.org_id = $3`,
    [sessionId, caller.userId, caller.orgId],
  );
  return (rowCount ?? 0) > 0;
}

export interface Member {
  readonly userId: string;
  readonly name: string | null;
  readonly role: string;
  readonly addedBy: string;
}

export async function membersOf(sessionId: string): Promise<Member[]> {
  const { rows } = await db().query<{ user_id: string; name: string | null; role: string; added_by: string }>(
    `SELECT m.user_id, u.name, u.role, m.added_by
       FROM session_members m JOIN users u ON u.id = m.user_id
      WHERE m.session_id = $1 ORDER BY m.added_at`,
    [sessionId],
  );
  return rows.map((r) => ({ userId: r.user_id, name: r.name, role: r.role, addedBy: r.added_by }));
}

/**
 * Adds `userId` to a session the sharer belongs to. The new member must be in
 * the same org. Returns why not, or null on success (re-adding is a no-op).
 */
export async function addMember(sessionId: string, sharer: Caller, userId: string): Promise<string | null> {
  if (!(await isMember(sessionId, sharer))) return "Only people in this chat can share it.";
  const { rowCount } = await db().query(`SELECT 1 FROM users WHERE id = $1 AND org_id = $2`, [userId, sharer.orgId]);
  if (!rowCount) return `${userId} is not a member of this org.`;
  await db().query(
    `INSERT INTO session_members (session_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [sessionId, userId, sharer.userId],
  );
  return null;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly members: readonly string[];
}

/** Sessions the caller is in, newest first. */
export async function sessionsOf(caller: Caller): Promise<SessionSummary[]> {
  const { rows } = await db().query<{ id: string; created_by: string; created_at: Date; members: string[] }>(
    `SELECT s.id, s.created_by, s.created_at, array_agg(all_m.user_id ORDER BY all_m.added_at) AS members
       FROM sessions s
       JOIN session_members me ON me.session_id = s.id AND me.user_id = $1
       JOIN session_members all_m ON all_m.session_id = s.id
      WHERE s.org_id = $2
      GROUP BY s.id ORDER BY s.created_at DESC LIMIT 50`,
    [caller.userId, caller.orgId],
  );
  return rows.map((r) => ({
    sessionId: r.id,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    members: r.members,
  }));
}
