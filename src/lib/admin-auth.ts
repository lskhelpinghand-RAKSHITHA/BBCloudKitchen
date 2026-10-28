import "server-only";

import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDatabase } from "@/lib/database";

const SESSION_COOKIE = "bb_admin_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 8;

export type AdminStaff = {
  id: string;
  email: string;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashStaffPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

export function createInitialAdmin(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Provide a valid administrator email address.");
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
      "Password must be 14-128 characters and include lowercase, uppercase, a number, and a symbol.",
    );
  }
  const db = getDatabase();
  const existing = db.prepare("SELECT 1 AS found FROM staff_users LIMIT 1").get();
  if (existing) throw new Error("An administrator is already configured.");

  const { salt, hash } = hashStaffPassword(password);
  db.prepare(
    "INSERT INTO staff_users (id, email, password_salt, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 'admin', 1, ?)",
  ).run(randomUUID(), email, salt, hash, new Date().toISOString());
}

function getLoginKey(email: string, addressKey: string) {
  return createHash("sha256")
    .update(`${email}\n${addressKey}`)
    .digest("hex");
}

export function getLoginAddressKey(address: string) {
  return createHash("sha256").update(address || "unknown").digest("hex");
}

function isLoginLocked(loginKey: string) {
  const row = getDatabase()
    .prepare("SELECT locked_until FROM login_attempts WHERE login_key = ?")
    .get(loginKey) as { locked_until: string | null } | undefined;
  return Boolean(row?.locked_until && Date.parse(row.locked_until) > Date.now());
}

function recordFailedLogin(loginKey: string) {
  const db = getDatabase();
  const now = Date.now();
  const row = db
    .prepare(
      "SELECT attempts, window_started_at FROM login_attempts WHERE login_key = ?",
    )
    .get(loginKey) as
    | { attempts: number; window_started_at: string }
    | undefined;
  const windowStarted = row ? Date.parse(row.window_started_at) : 0;
  const withinWindow = row && now - windowStarted < LOGIN_WINDOW_MS;
  const attempts = withinWindow ? row.attempts + 1 : 1;
  const startedAt = withinWindow ? row.window_started_at : new Date(now).toISOString();
  const lockedUntil =
    attempts >= LOGIN_ATTEMPT_LIMIT
      ? new Date(now + LOGIN_WINDOW_MS).toISOString()
      : null;
  db.prepare(
    `INSERT INTO login_attempts (login_key, attempts, window_started_at, locked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(login_key) DO UPDATE SET
       attempts = excluded.attempts,
       window_started_at = excluded.window_started_at,
       locked_until = excluded.locked_until`,
  ).run(loginKey, attempts, startedAt, lockedUntil);
}

export async function authenticateStaff(
  emailInput: string,
  password: string,
  addressKey: string,
) {
  const email = emailInput.trim().toLowerCase();
  const loginKey = getLoginKey(email, addressKey);
  const emailLoginKey = getLoginKey(email, "email-wide");
  if (isLoginLocked(loginKey) || isLoginLocked(emailLoginKey)) return false;

  const row = getDatabase()
    .prepare(
      "SELECT id, email, password_salt, password_hash FROM staff_users WHERE email = ? AND active = 1",
    )
    .get(email) as
    | {
        id: string;
        email: string;
        password_salt: string;
        password_hash: string;
      }
    | undefined;
  const salt = row?.password_salt ?? "bb-cloud-kitchen-invalid-login-salt";
  const storedHash = row?.password_hash ?? "0".repeat(128);
  const candidateHash = scryptSync(password, salt, 64);
  const expectedHash = Buffer.from(storedHash, "hex");
  const valid =
    row !== undefined &&
    expectedHash.length === candidateHash.length &&
    timingSafeEqual(candidateHash, expectedHash);

  if (!valid) {
    recordFailedLogin(loginKey);
    if (emailLoginKey !== loginKey) recordFailedLogin(emailLoginKey);
    return false;
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  getDatabase()
    .prepare("INSERT INTO staff_sessions (token_hash, staff_id, expires_at) VALUES (?, ?, ?)")
    .run(hashToken(token), row.id, expiresAt);
  getDatabase().prepare("DELETE FROM login_attempts WHERE login_key = ?").run(loginKey);
  getDatabase()
    .prepare("DELETE FROM login_attempts WHERE login_key = ?")
    .run(emailLoginKey);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(expiresAt),
  });
  return true;
}

export async function getAdminSession(): Promise<AdminStaff | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

  const db = getDatabase();
  db.prepare("DELETE FROM staff_sessions WHERE expires_at <= ?").run(
    new Date().toISOString(),
  );
  const row = db
    .prepare(
      `SELECT staff_users.id, staff_users.email
       FROM staff_sessions
       JOIN staff_users ON staff_users.id = staff_sessions.staff_id
       WHERE staff_sessions.token_hash = ?
         AND staff_sessions.expires_at > ?
         AND staff_users.active = 1`,
    )
    .get(hashToken(token), new Date().toISOString()) as AdminStaff | undefined;
  return row ?? null;
}

export async function requireAdmin() {
  const staff = await getAdminSession();
  if (!staff) redirect("/admin/login");
  return staff;
}

export async function endAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    getDatabase()
      .prepare("DELETE FROM staff_sessions WHERE token_hash = ?")
      .run(hashToken(token));
  }
  cookieStore.delete(SESSION_COOKIE);
}

export function getStaffCount() {
  const row = getDatabase()
    .prepare("SELECT COUNT(*) AS count FROM staff_users WHERE active = 1")
    .get() as { count: number };
  return row.count;
}
