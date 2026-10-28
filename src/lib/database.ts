import "server-only";

import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

declare global {
  var bbCloudKitchenDatabase: DatabaseSync | undefined;
}

export function getDatabase() {
  if (globalThis.bbCloudKitchenDatabase) return globalThis.bbCloudKitchenDatabase;

  const configuredPath = process.env.DATABASE_PATH;
  if (process.env.NODE_ENV === "production" && !configuredPath) {
    throw new Error("DATABASE_PATH must point to durable SQLite storage in production.");
  }
  if (configuredPath && !isAbsolute(configuredPath)) {
    throw new Error("DATABASE_PATH must be an absolute filesystem path.");
  }

  const databasePath =
    configuredPath ?? join(process.cwd(), "data", "bb-cloud-kitchen.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      active INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS business_configuration (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role = 'admin'),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff_sessions (
      token_hash TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      login_key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      window_started_at TEXT NOT NULL,
      locked_until TEXT
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_idempotency (
      idempotency_key TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      fingerprint TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payment_events (
      event_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at);
    CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
    CREATE INDEX IF NOT EXISTS staff_sessions_expiry_idx ON staff_sessions(expires_at);
  `);
  globalThis.bbCloudKitchenDatabase = database;
  return database;
}
