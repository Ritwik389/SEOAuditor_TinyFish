import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { promisify } from "node:util";
import { createUser, findUserByEmail, findUserById } from "../db/repo";
import { storeMode } from "../db/mongo";
import { hmac, safeEqual, sha256 } from "./crypto";

// Multi-user accounts. Each user owns their audits, settings and API keys (see db/repo.ts).
// Passwords: scrypt with a per-user salt. Sessions: HMAC-signed, HttpOnly, SameSite=Strict cookie.

export const COOKIE = "sniff_session";
const MAX_AGE = 60 * 60 * 24 * 7;
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface SessionUser {
  userId: string;
}

/** Signing secret: SESSION_SECRET, else derived from CREDENTIAL_ENCRYPTION_KEY. Never from user input. */
function secret(): string | null {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.CREDENTIAL_ENCRYPTION_KEY) return sha256("sniffsite-session:" + process.env.CREDENTIAL_ENCRYPTION_KEY);
  return null;
}

/** Accounts need a database to live in and a secret to sign sessions with. */
export function authReady(): { ok: boolean; reason?: string } {
  if (storeMode() === "none") return { ok: false, reason: "The server has no database configured (MONGODB_URI), so accounts cannot be stored." };
  if (!secret()) return { ok: false, reason: "Set SESSION_SECRET (or CREDENTIAL_ENCRYPTION_KEY) on the server so sessions can be signed." };
  return { ok: true };
}

// ---- Passwords ----------------------------------------------------------------------------

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${(await scryptAsync(pw, salt, 64)).toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scryptAsync(pw, Buffer.from(salt, "base64"), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

// A throwaway hash so unknown-email logins cost the same as known ones (no user enumeration via timing).
let dummy: Promise<string> | undefined;

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export async function signUp(emailRaw: string, password: string): Promise<{ user: SessionUser } | { error: string }> {
  const email = normalizeEmail(emailRaw);
  if (!EMAIL_RE.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  if (password.length < 10) return { error: "Use a password of at least 10 characters." };
  const user = { userId: randomUUID().replace(/-/g, ""), email, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
  if (!(await createUser(user))) return { error: "An account with this email already exists. Sign in instead." };
  return { user: { userId: user.userId } };
}

export async function signIn(emailRaw: string, password: string): Promise<SessionUser | null> {
  const u = await findUserByEmail(normalizeEmail(emailRaw));
  if (!u) {
    await verifyPassword(password, await (dummy ??= hashPassword("sniffsite-dummy-password")));
    return null;
  }
  return (await verifyPassword(password, u.passwordHash)) ? { userId: u.userId } : null;
}

// ---- Sessions ---------------------------------------------------------------------------------

export function issueToken(userId: string): { value: string; maxAge: number } {
  const s = secret();
  if (!s) throw new Error("session secret missing");
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  return { value: `${userId}.${exp}.${hmac(s, `${userId}.${exp}`)}`, maxAge: MAX_AGE };
}

export function verifyToken(token: string | undefined | null): SessionUser | null {
  const s = secret();
  if (!s || !token) return null;
  const [userId, exp, sig] = token.split(".");
  if (!userId || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  return safeEqual(sig, hmac(s, `${userId}.${exp}`)) ? { userId } : null;
}

export function tokenFromRequest(req: Request): string | undefined {
  const m = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m?.[1];
}

export function sessionCookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

/** For server components / layouts. */
export async function currentUser(): Promise<SessionUser | null> {
  return verifyToken((await cookies()).get(COOKIE)?.value);
}

export interface PageUser extends SessionUser {
  email: string;
}

/** Call first in every protected page. Preserves where the visitor was going. */
export async function requireUser(next = "/audit/new"): Promise<PageUser> {
  const s = await currentUser();
  const u = s && storeMode() !== "none" ? await findUserById(s.userId).catch(() => null) : null;
  if (!u) redirect(`/login?next=${encodeURIComponent(next)}`);
  return { userId: u.userId, email: u.email };
}
