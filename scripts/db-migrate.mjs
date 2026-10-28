import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Set DATABASE_URL to your Supabase PostgreSQL connection string.");
}

const pool = new pg.Pool({
  connectionString,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  max: 1,
  ssl: { rejectUnauthorized: true },
});

try {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS bb_internal;
    REVOKE ALL ON SCHEMA bb_internal FROM PUBLIC, anon, authenticated;
    CREATE TABLE IF NOT EXISTS bb_internal.schema_migrations (
      migration_name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const directory = join(process.cwd(), "supabase", "migrations");
  const migrations = (await readdir(directory))
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort();

  for (const migrationName of migrations) {
    const alreadyApplied = await pool.query(
      "SELECT 1 FROM bb_internal.schema_migrations WHERE migration_name = $1",
      [migrationName],
    );
    if (alreadyApplied.rowCount) continue;

    const sql = await readFile(join(directory, migrationName), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO bb_internal.schema_migrations (migration_name) VALUES ($1)",
        [migrationName],
      );
      await client.query("COMMIT");
      console.log(`Applied ${migrationName}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  console.log("Database migrations are up to date.");
} catch (error) {
  console.error("Database migration failed. Check connectivity, credentials, and database permissions.");
  throw error;
} finally {
  await pool.end();
}
