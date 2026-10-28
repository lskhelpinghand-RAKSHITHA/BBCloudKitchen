import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

if (process.env.APP_ENV !== "development") {
  throw new Error("Refusing to load demo records unless APP_ENV=development.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL to your development Supabase PostgreSQL connection string.");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  max: 1,
  ssl: { rejectUnauthorized: true },
});

try {
  const sql = await readFile(join(process.cwd(), "supabase", "seed.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.environment', 'development', true)");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Development-only demo menu and business settings loaded.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error("Development seed failed; no seed data was committed.");
  throw error;
} finally {
  await pool.end();
}
