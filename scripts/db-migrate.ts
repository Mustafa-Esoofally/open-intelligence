// Apply db/schema.sql, db/seed.sql, then db/seed.local.sql if present: `npm run db:migrate`. All are idempotent.
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set (see .env.local / README.md).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const file of ["db/schema.sql", "db/seed.sql", "db/seed.local.sql"].filter((f) => existsSync(f))) {
    await client.query(readFileSync(file, "utf8"));
    console.log(`applied ${file}`);
  }
  const { rows } = await client.query("SELECT id, role FROM users ORDER BY id");
  console.log(`users: ${rows.map((r) => `${r.id} (${r.role})`).join(", ")}`);
} finally {
  await client.end();
}
