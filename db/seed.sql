-- Dev org with two example users. Re-running keeps rows and refreshes roles.
-- Add your own people in db/seed.local.sql (gitignored); db:migrate applies it after this file.

INSERT INTO orgs (id, name) VALUES ('acme', 'Acme') ON CONFLICT DO NOTHING;

INSERT INTO teams (org_id, id, name) VALUES ('acme', 'eng', 'Engineering') ON CONFLICT DO NOTHING;

INSERT INTO users (id, org_id, name, role) VALUES
  ('admin@example.com', 'acme', 'Ada Admin', 'admin'),
  ('member@example.com', 'acme', 'Max Member', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO team_members (org_id, team_id, user_id) VALUES
  ('acme', 'eng', 'admin@example.com'),
  ('acme', 'eng', 'member@example.com')
ON CONFLICT DO NOTHING;
