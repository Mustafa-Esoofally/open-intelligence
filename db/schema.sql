-- open-glass schema (docs/ORG.md section 2). Idempotent: `npm run db:migrate` re-runs it.

CREATE TABLE IF NOT EXISTS orgs (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  org_id     text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  id         text NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);

-- One row per person. `id` is their login email until real SSO assigns stable ids.
CREATE TABLE IF NOT EXISTS users (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  name       text,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'finance', 'lead', 'member', 'guest')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- `position` orders a user's teams; position 0 is their primary team (team memory slot).
CREATE TABLE IF NOT EXISTS team_members (
  org_id   text NOT NULL,
  team_id  text NOT NULL,
  user_id  text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, team_id, user_id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams (org_id, id) ON DELETE CASCADE
);

-- Chat sessions and who may read or post to them. eve's routes authenticate the
-- caller but never check whose session it is; agent/channels/eve.ts enforces
-- these rows on every session route (create records the creator as a member).
CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_members (
  session_id text NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_by   text NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS session_members_user ON session_members (user_id);
