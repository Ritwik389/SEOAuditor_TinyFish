import { z } from "zod";
import { getSecret, getSettingsDoc, putSecret, deleteSecret, putSettingsDoc } from "./db/repo";
import { storeMode } from "./db/mongo";
import { encryptionAvailable, open, seal } from "./security/crypto";

export const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"] as const;

export const SettingsSchema = z.object({
  geminiModel: z.enum(GEMINI_MODELS).default("gemini-3.8-flash"),
  defaultVerification: z.enum(["off", "auto", "always"]).default("auto"),
  defaultLocation: z.string().trim().max(2).optional(),
  defaultLanguage: z.string().trim().max(8).optional(),
  retentionDays: z.number().int().min(0).max(3650).default(0),
  maxEvidenceChars: z.number().int().min(5_000).max(300_000).default(80_000),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** Zod 4 applies .default() even inside .partial(), which would reset untouched settings on PATCH, so the patch shape has no defaults. */
export const SettingsPatchSchema = z
  .object({
    geminiModel: z.enum(GEMINI_MODELS),
    defaultVerification: z.enum(["off", "auto", "always"]),
    defaultLocation: z.string().trim().max(2),
    defaultLanguage: z.string().trim().max(8),
    retentionDays: z.number().int().min(0).max(3650),
    maxEvidenceChars: z.number().int().min(5_000).max(300_000),
  })
  .partial()
  .strict();

/** Settings are per user. */
export async function getSettings(userId: string): Promise<Settings> {
  let stored: Record<string, unknown> = {};
  if (storeMode() !== "none") {
    try {
      stored = (await getSettingsDoc(userId)) ?? {};
    } catch {
      /* DB unavailable: fall back to defaults */
    }
  }
  const envModel = process.env.GEMINI_MODEL; // operator-chosen default model, overridable per user
  const parsed = SettingsSchema.safeParse({ ...(envModel && !stored.geminiModel ? { geminiModel: envModel } : {}), ...stored });
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

export async function updateSettings(userId: string, patch: Partial<Settings>): Promise<Settings> {
  const next = SettingsSchema.parse({ ...(await getSettings(userId)), ...patch });
  await putSettingsDoc(userId, next);
  return next;
}

// ---- Credentials -------------------------------------------------------------------------------
// Each user supplies their own TinyFish / Gemini keys on the Setup page. They are encrypted with AES-256-GCM
// (key from the environment, not the database) and bound to the owning user + provider via AAD, so one user's
// ciphertext cannot be decrypted as another user's. There is deliberately NO shared deployment-wide key.

export type Provider = "tinyfish" | "gemini";

export interface CredentialStatus {
  configured: boolean;
  source: "saved" | "none";
  hint?: string;
}

const aad = (userId: string, p: Provider) => `${userId}:${p}`;

export async function getCredential(userId: string, p: Provider): Promise<string | null> {
  if (storeMode() === "none" || !encryptionAvailable()) return null;
  try {
    const s = await getSecret(userId, p);
    return s ? open(s, aad(userId, p)) : null;
  } catch {
    return null;
  }
}

export async function credentialStatus(userId: string, p: Provider): Promise<CredentialStatus> {
  if (storeMode() !== "none") {
    try {
      const s = await getSecret(userId, p);
      if (s) return { configured: true, source: "saved", hint: s.hint };
    } catch {
      /* ignore */
    }
  }
  return { configured: false, source: "none" };
}

export function canSaveCredentials(): { ok: boolean; reason?: string } {
  if (storeMode() === "none") return { ok: false, reason: "The server has no database configured (MONGODB_URI), so keys cannot be stored." };
  if (!encryptionAvailable()) return { ok: false, reason: "The server's CREDENTIAL_ENCRYPTION_KEY is missing or shorter than 32 characters, so keys cannot be encrypted at rest." };
  return { ok: true };
}

export async function saveCredential(userId: string, p: Provider, value: string) {
  const can = canSaveCredentials();
  if (!can.ok) throw new Error(can.reason);
  const sealed = seal(value, aad(userId, p));
  await putSecret({ userId, provider: p, ...sealed, hint: "…" + value.slice(-4), updatedAt: new Date().toISOString() });
}

export async function clearCredential(userId: string, p: Provider) {
  await deleteSecret(userId, p);
}
