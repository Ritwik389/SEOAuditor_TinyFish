import { afterAll, describe, expect, it } from "vitest";

// Runs ONLY when a real MongoDB is supplied:  MONGODB_URI_TEST=mongodb://... npm test
// (uses a throwaway database name). Otherwise it is skipped, and the suite reports it as skipped, not passed.
const uri = process.env.MONGODB_URI_TEST;

describe.skipIf(!uri)("MongoDB persistence (real database)", () => {
  const dbName = `sniffsite_test_${Date.now()}`;
  afterAll(async () => {
    const { MongoClient } = await import("mongodb");
    const c = await new MongoClient(uri!).connect();
    await c.db(dbName).dropDatabase();
    await c.close();
  });

  it("connects, creates indexes, and round-trips audits, evidence, findings and filters", async () => {
    delete process.env.SNIFFSITE_STORE; // vitest.config forces the memory store; this test needs the real driver
    process.env.MONGODB_URI = uri!;
    process.env.MONGODB_DB_NAME = dbName;
    const { testMongo } = await import("@/lib/db/mongo");
    const t = await testMongo();
    expect(t).toMatchObject({ ok: true, mode: "mongo" });

    const repo = await import("@/lib/db/repo");
    // Fresh objects each time: the driver stamps an _id onto whatever it inserts.
    const mk = (userId: string, email: string) => ({ userId, email, passwordHash: "scrypt$x$y", createdAt: new Date().toISOString() });
    expect(await repo.createUser(mk("u-real-1", "real@example.com"))).toBe(true);
    expect(await repo.createUser(mk("u-real-2", "real@example.com"))).toBe(false); // unique email index on a real server
    expect((await repo.findUserByEmail("real@example.com"))?.userId).toBe("u-real-1");
    const results = await Promise.all([repo.createUser(mk("u3", "race@example.com")), repo.createUser(mk("u4", "race@example.com"))]);
    expect(results.filter(Boolean)).toHaveLength(1); // concurrent duplicate sign-ups: exactly one wins
    const { createAuditFromInput } = await import("@/lib/audit/create");
    process.env.SNIFFSITE_ALLOW_PRIVATE_TARGETS = "1";
    const a = await createAuditFromInput({ url: "https://example.com/pricing", queries: [{ text: "Pricing Query", source: "user" }], verification: "off" } as never, "u1");
    expect((await repo.getAudit(a.auditId, "u1"))?.status).toBe("queued");
    expect(await repo.claimAudit(a.auditId)).toBe(true);
    expect(await repo.claimAudit(a.auditId)).toBe(false); // atomic claim against a real server
    const list = await repo.listAudits("u1", { q: "pricing query" });
    expect(list.total).toBe(1);
    expect((await repo.listAudits("someone-else", {})).total).toBe(0); // tenant isolation on a real server
    expect(await repo.getAudit(a.auditId, "someone-else")).toBeNull();
    await repo.recordTest("u1", "tinyfish", "search", { ok: true, message: "ok" });
    expect((await repo.getIntegrationMeta("u1", "tinyfish"))?.tests?.search?.ok).toBe(true);
    expect(await repo.deleteAudit(a.auditId, "u1")).toBe(true);
    expect((await repo.listAudits("u1", {})).total).toBe(0);
  });
});
