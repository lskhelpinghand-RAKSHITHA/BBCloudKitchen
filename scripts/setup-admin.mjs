import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? "";
const password = process.env.ADMIN_PASSWORD ?? "";
const configuredPath = process.env.DATABASE_PATH;
const databasePath = configuredPath ?? join(process.cwd(), "data", "bb-cloud-kitchen.sqlite");

if (process.env.NODE_ENV === "production" && !process.env.DATABASE_PATH) {
  throw new Error("Set DATABASE_PATH to the durable production database file.");
}
if (configuredPath && !isAbsolute(configuredPath)) {
  throw new Error("DATABASE_PATH must be an absolute filesystem path.");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("Set ADMIN_EMAIL to a valid administrator email address.");
}
if (
  password.length < 14 ||
  password.length > 128 ||
  !/[a-z]/.test(password) ||
  !/[A-Z]/.test(password) ||
  !/\d/.test(password) ||
  !/[^A-Za-z0-9]/.test(password)
) {
  throw new Error(
    "ADMIN_PASSWORD must be 14-128 characters and include lowercase, uppercase, a number, and a symbol.",
  );
}

mkdirSync(dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS staff_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role = 'admin'),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  BEGIN IMMEDIATE;
`);

try {
  if (database.prepare("SELECT 1 AS found FROM staff_users LIMIT 1").get()) {
    throw new Error("An administrator is already configured; setup is one-time only.");
  }
  const salt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(password, salt, 64).toString("hex");
  database
    .prepare(
      "INSERT INTO staff_users (id, email, password_salt, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 'admin', 1, ?)",
    )
    .run(randomUUID(), email, salt, passwordHash, new Date().toISOString());
  database.exec("COMMIT");
  console.log(`Initial administrator created for ${email}.`);
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}
