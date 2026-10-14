import { MongoClient } from "mongodb";
import { MemoryDb, type Db } from "./memory";
import { SCHEMA_VERSION } from "../types";
import { demoDb } from "./demo-context";

// Connection is configured by the deployment administrator through MONGODB_URI only.
// It is deliberately NOT collectable through the website.

export type StoreMode = "mongo" | "memory" | "none";

export function storeMode(): StoreMode {
  if (process.env.NODE_ENV !== "production" && process.env.SNIFFSITE_STORE === "memory") return "memory";
  return process.env.MONGODB_URI ? "mongo" : "none";
}

export class StoreNotConfigured extends Error {
  constructor() {
    super("Database is not configured. The administrator must set MONGODB_URI.");
    this.name = "StoreNotConfigured";
  }
}

const g = globalThis as unknown as {
  __sniffMongo?: Promise<MongoClient>;
  __sniffMem?: MemoryDb;
  __sniffIndexes?: Promise<void>;
};

function client(): Promise<MongoClient> {
  // Cached on globalThis so dev hot-reload and warm serverless invocations reuse one pool.
  g.__sniffMongo ??= new MongoClient(process.env.MONGODB_URI!, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 8000,
    appName: "sniffsite",
  })
    .connect()
    .catch((e) => {
      g.__sniffMongo = undefined;
      throw e;
    });
  return g.__sniffMongo;
}

export function dbName(): string {
  return process.env.MONGODB_DB_NAME || "sniffsite";
}

export async function getDb(): Promise<Db> {
  const scoped = demoDb();
  if (scoped) return scoped;
  const mode = storeMode();
  if (mode === "none") throw new StoreNotConfigured();
  if (mode === "memory") {
    g.__sniffMem ??= new MemoryDb();
    return g.__sniffMem;
  }
  const db = (await client()).db(dbName()) as unknown as Db;
  g.__sniffIndexes ??= ensureIndexes(db).catch((e) => {
    g.__sniffIndexes = undefined;
    throw e;
  });
  await g.__sniffIndexes;
  return db;
}

export function resetMemoryStore() {
  g.__sniffMem = new MemoryDb();
}

/** Idempotent index creation + schema version marker (explicit versioning in place of migrations). */
async function ensureIndexes(db: Db) {
  // v1 -> v2: integration docs became per-user, so the old single-key unique indexes must go.
  for (const c of ["integrationMetadata", "integrationSecrets"]) await db.collection(c).dropIndex("provider_1").catch(() => undefined);
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("users").createIndex({ userId: 1 }, { unique: true });
  await db.collection("audits").createIndex({ auditId: 1 }, { unique: true });
  await db.collection("audits").createIndex({ ownerId: 1, createdAt: -1 });
  await db.collection("audits").createIndex({ ownerId: 1, status: 1, createdAt: -1 });
  await db.collection("audits").createIndex({ ownerId: 1, normalizedTargetUrl: 1 });
  await db.collection("auditEvidence").createIndex({ auditId: 1, evidenceId: 1 }, { unique: true });
  await db.collection("auditFindings").createIndex({ auditId: 1, findingId: 1 }, { unique: true });
  await db.collection("integrationMetadata").createIndex({ userId: 1, provider: 1 }, { unique: true });
  await db.collection("integrationSecrets").createIndex({ userId: 1, provider: 1 }, { unique: true });
  await db.collection("settings").createIndex({ userId: 1 }, { unique: true });
  await db.collection("meta").updateOne({ _id: "schema" }, { $set: { version: SCHEMA_VERSION, updatedAt: new Date().toISOString() } }, { upsert: true });
}

// ---- Connection test (used by the Setup page) --------------------------------------

export interface MongoTestResult {
  ok: boolean;
  stage: "config" | "connect" | "write" | "read" | "cleanup" | "done";
  message: string;
  latencyMs?: number;
  mode: StoreMode;
}

export async function testMongo(): Promise<MongoTestResult> {
  const mode = storeMode();
  if (mode === "none") return { ok: false, stage: "config", mode, message: "MONGODB_URI is not set in the server environment. The administrator must set it (see the setup guide)." };
  const t0 = Date.now();
  let db: Db;
  try {
    db = await getDb();
  } catch (e) {
    return { ok: false, stage: "connect", mode, message: "Could not connect: " + cleanMongoError(e) };
  }
  const probe = { _id: `probe-${Date.now()}` as unknown as string, at: new Date().toISOString() };
  const col = db.collection("healthcheck");
  try {
    await col.insertOne(probe as never);
  } catch (e) {
    return { ok: false, stage: "write", mode, message: "Connected, but writing failed (check the database user's role): " + cleanMongoError(e) };
  }
  try {
    const back = await col.findOne({ _id: probe._id } as never);
    if (!back) return { ok: false, stage: "read", mode, message: "Write succeeded but the document could not be read back." };
  } catch (e) {
    return { ok: false, stage: "read", mode, message: "Reading failed: " + cleanMongoError(e) };
  }
  try {
    await col.deleteOne({ _id: probe._id } as never);
  } catch (e) {
    return { ok: false, stage: "cleanup", mode, message: "Read/write OK but cleanup failed: " + cleanMongoError(e) };
  }
  return {
    ok: true,
    stage: "done",
    mode,
    latencyMs: Date.now() - t0,
    message: mode === "memory" ? "In-memory TEST store active. Data is not durable." : "Connected; write, read and delete verified.",
  };
}

function cleanMongoError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // Messages can echo connection strings; keep them out of responses.
  return m.replace(/mongodb(\+srv)?:\/\/\S+/gi, "[uri]").slice(0, 300);
}
