import { canSaveCredentials, credentialStatus, getSettings, type CredentialStatus } from "./config";
import { storeMode, type StoreMode } from "./db/mongo";
import { getIntegrationMeta, type IntegrationMeta } from "./db/repo";
import { authReady } from "./security/auth";

export interface IntegrationsStatus {
  auth: { ok: boolean; reason?: string };
  storage: { mode: StoreMode; canSaveCredentials: boolean; reason?: string };
  mongodb: { configured: boolean; mode: StoreMode; tests: IntegrationMeta["tests"] };
  tinyfish: CredentialStatus & { tests: IntegrationMeta["tests"] };
  gemini: CredentialStatus & { model: string; tests: IntegrationMeta["tests"] };
  /** Live audits need Mongo (or the dev test store) and TinyFish. Gemini is optional. */
  readyForLiveAudit: boolean;
}

/** A misconfigured database must never make the Setup page hang: DB-backed reads give up after 3s. */
const withTimeout = <T,>(p: Promise<T>, fallback: T, ms = 3000): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

async function meta(userId: string, p: string): Promise<IntegrationMeta["tests"]> {
  if (storeMode() === "none") return {};
  return withTimeout(getIntegrationMeta(userId, p).then((m) => m?.tests ?? {}), {});
}

/** Safe-by-construction status: only booleans, sources, last-4 hints and test outcomes. */
export async function integrationsStatus(userId: string): Promise<IntegrationsStatus> {
  const none: CredentialStatus = { configured: false, source: "none" };
  const [tf, gem, settings, mTests, tTests, gTests] = await Promise.all([
    withTimeout(credentialStatus(userId, "tinyfish"), none),
    withTimeout(credentialStatus(userId, "gemini"), none),
    withTimeout(getSettings(userId).then((x) => x.geminiModel), "gemini-3.8-flash"),
    meta(userId, "mongodb"),
    meta(userId, "tinyfish"),
    meta(userId, "gemini"),
  ]);
  const mode = storeMode();
  const can = canSaveCredentials();
  return {
    auth: authReady(),
    storage: { mode, canSaveCredentials: can.ok, reason: can.reason },
    mongodb: { configured: mode !== "none", mode, tests: mTests },
    tinyfish: { ...tf, tests: tTests },
    gemini: { ...gem, model: settings, tests: gTests },
    readyForLiveAudit: mode !== "none" && tf.configured,
  };
}
