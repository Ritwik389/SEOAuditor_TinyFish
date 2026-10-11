import { getDb } from "./mongo";
import type { Doc } from "./memory";
import type { AuditDoc, AuditStatus, EvidenceRecord, Finding } from "../types";

// Persistence. Tenant isolation rule: every function that serves a user request takes `ownerId`.
// `ownerId: null` means "internal caller" (the orchestrator, which already holds an audit it was started for)
// and must be written out explicitly so it cannot be forgotten by accident.

const strip = <T>(d: Doc | null): T | null => {
  if (!d) return null;
  const { _id, searchText, ...rest } = d;
  void _id;
  void searchText;
  return rest as T;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const scope = (auditId: string, ownerId: string | null) => (ownerId === null ? { auditId } : { auditId, ownerId });

// ---- Users ----------------------------------------------------------------------------------

export interface UserDoc {
  userId: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export async function createUser(u: UserDoc): Promise<boolean> {
  const db = await getDb();
  if (await db.collection("users").findOne({ email: u.email })) return false;
  try {
    await db.collection("users").insertOne(u);
    return true;
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return false; // unique index won the race
    throw e;
  }
}
export async function findUserByEmail(email: string): Promise<UserDoc | null> {
  const db = await getDb();
  return strip<UserDoc>(await db.collection("users").findOne({ email }));
}
export async function findUserById(userId: string): Promise<UserDoc | null> {
  const db = await getDb();
  return strip<UserDoc>(await db.collection("users").findOne({ userId }));
}

// ---- Audits ---------------------------------------------------------------------------------

export async function createAudit(a: AuditDoc) {
  const db = await getDb();
  const searchText = [a.targetUrl, a.label ?? "", ...a.queries.map((q) => q.text)].join(" ").toLowerCase();
  await db.collection("audits").insertOne({ ...a, searchText });
}

export async function getAudit(auditId: string, ownerId: string | null): Promise<AuditDoc | null> {
  const db = await getDb();
  return strip<AuditDoc>(await db.collection("audits").findOne(scope(auditId, ownerId)));
}

/** Internal: callers must already have established ownership (or be the orchestrator). */
export async function patchAudit(auditId: string, set: Partial<AuditDoc>) {
  const db = await getDb();
  await db.collection("audits").updateOne({ auditId }, { $set: { ...set, updatedAt: new Date().toISOString() } });
}

/** Atomically move queued -> running. Returns false if another invocation already claimed it. */
export async function claimAudit(auditId: string): Promise<boolean> {
  const db = await getDb();
  const r = await db
    .collection("audits")
    .updateOne({ auditId, status: "queued" }, { $set: { status: "running", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  return r.modifiedCount === 1;
}

export interface ListQuery {
  q?: string;
  status?: AuditStatus;
  from?: string;
  to?: string;
  sort?: "newest" | "oldest";
  page?: number;
  pageSize?: number;
}

export async function listAudits(ownerId: string, p: ListQuery) {
  const db = await getDb();
  const filter: Doc = { ownerId };
  if (p.q) filter.searchText = { $regex: escapeRe(p.q.toLowerCase()) };
  if (p.status) filter.status = p.status;
  if (p.from || p.to) filter.createdAt = { ...(p.from ? { $gte: p.from } : {}), ...(p.to ? { $lte: p.to } : {}) };
  const pageSize = Math.min(Math.max(p.pageSize ?? 20, 1), 100);
  const page = Math.max(p.page ?? 1, 1);
  const col = db.collection("audits");
  const [total, rows] = await Promise.all([
    col.countDocuments(filter),
    col
      .find(filter, { projection: { log: 0, stages: 0 } })
      .sort({ createdAt: p.sort === "oldest" ? 1 : -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
  ]);
  return { total, page, pageSize, items: rows.map((r) => strip<AuditDoc>(r)!) };
}

export async function deleteAudit(auditId: string, ownerId: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.collection("audits").deleteOne({ auditId, ownerId });
  if (r.deletedCount !== 1) return false; // not theirs (or gone): touch nothing else
  await Promise.all([db.collection("auditEvidence").deleteMany({ auditId }), db.collection("auditFindings").deleteMany({ auditId })]);
  return true;
}

// Evidence and findings are only reachable after the caller has loaded the audit with getAudit(id, ownerId).
export async function saveEvidence(records: EvidenceRecord[]) {
  if (!records.length) return;
  const db = await getDb();
  await db.collection("auditEvidence").insertMany(records);
}

export async function listEvidence(auditId: string): Promise<EvidenceRecord[]> {
  const db = await getDb();
  const rows = await db.collection("auditEvidence").find({ auditId }).sort({ capturedAt: 1 }).toArray();
  return rows.map((r) => strip<EvidenceRecord>(r)!);
}

export async function replaceFindings(auditId: string, findings: Finding[]) {
  const db = await getDb();
  await db.collection("auditFindings").deleteMany({ auditId });
  if (findings.length) await db.collection("auditFindings").insertMany(findings);
}

export async function listFindings(auditId: string): Promise<Finding[]> {
  const db = await getDb();
  const rows = await db.collection("auditFindings").find({ auditId }).toArray();
  return rows.map((r) => strip<Finding>(r)!);
}

// ---- Integrations (per user; safe metadata only) -------------------------------------------------

export interface IntegrationMeta {
  userId: string;
  provider: string;
  tests?: Record<string, { ok: boolean; testedAt: string; message: string; httpStatus?: number; latencyMs?: number }>;
  updatedAt?: string;
}

export async function getIntegrationMeta(userId: string, provider: string): Promise<IntegrationMeta | null> {
  const db = await getDb();
  return strip<IntegrationMeta>(await db.collection("integrationMetadata").findOne({ userId, provider }));
}

export async function recordTest(userId: string, provider: string, op: string, result: { ok: boolean; message: string; httpStatus?: number; latencyMs?: number }) {
  const db = await getDb();
  await db
    .collection("integrationMetadata")
    .updateOne({ userId, provider }, { $set: { userId, provider, [`tests.${op}`]: { ...result, testedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() } }, { upsert: true });
}

export async function clearTests(userId: string, provider: string) {
  const db = await getDb();
  await db.collection("integrationMetadata").deleteOne({ userId, provider });
}

export interface SecretDoc {
  userId: string;
  provider: string;
  iv: string;
  tag: string;
  ct: string;
  updatedAt: string;
  hint: string; // last 4 chars only, for UI confirmation
}
export async function getSecret(userId: string, provider: string): Promise<SecretDoc | null> {
  const db = await getDb();
  return strip<SecretDoc>(await db.collection("integrationSecrets").findOne({ userId, provider }));
}
export async function putSecret(s: SecretDoc) {
  const db = await getDb();
  await db.collection("integrationSecrets").replaceOne({ userId: s.userId, provider: s.provider }, s, { upsert: true });
}
export async function deleteSecret(userId: string, provider: string) {
  const db = await getDb();
  await db.collection("integrationSecrets").deleteOne({ userId, provider });
}

// ---- Settings & retention -------------------------------------------------------------------------

export async function getSettingsDoc(userId: string): Promise<Doc | null> {
  const db = await getDb();
  return strip<Doc>(await db.collection("settings").findOne({ userId }));
}
export async function putSettingsDoc(userId: string, s: Doc) {
  const db = await getDb();
  await db.collection("settings").replaceOne({ userId }, { userId, ...s }, { upsert: true });
}

/** Delete one user's audits (and evidence/findings) older than `days`. 0 disables cleanup. */
export async function cleanupOld(days: number, ownerId: string): Promise<number> {
  if (!days || days <= 0) return 0;
  const db = await getDb();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const old = await db.collection("audits").find({ ownerId, createdAt: { $lt: cutoff } }, { projection: { auditId: 1 } }).limit(50).toArray();
  for (const o of old) await deleteAudit(o.auditId, ownerId);
  return old.length;
}
