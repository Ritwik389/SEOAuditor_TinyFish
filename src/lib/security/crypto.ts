import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// AES-256-GCM for credentials stored in MongoDB. The key lives ONLY in the environment.
function key(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("CREDENTIAL_ENCRYPTION_KEY is not set");
  // Preferred: exactly 32 random bytes, base64 (used as-is). Otherwise any secret of 32+ characters is accepted and
  // stretched to an AES-256 key with SHA-256, so a long random string works without exact-length base64.
  const buf = Buffer.from(raw, "base64");
  if (buf.length === 32 && buf.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) return buf;
  if (raw.length < 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters");
  return createHash("sha256").update("sniffsite-credential-key:" + raw).digest();
}

export function encryptionAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export interface Sealed {
  iv: string;
  tag: string;
  ct: string;
}

export function seal(plain: string, aad: string): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}

export function open(s: Sealed, aad: string): string {
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(s.iv, "base64"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(s.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(s.ct, "base64")), d.final()]).toString("utf8");
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function hmac(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}
