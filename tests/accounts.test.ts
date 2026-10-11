import { beforeEach, describe, expect, it } from "vitest";
import { canSaveCredentials, clearCredential, credentialStatus, getCredential, getSettings, saveCredential, updateSettings } from "@/lib/config";
import { createAudit, deleteAudit, getAudit, getSecret, listAudits, putSecret, getIntegrationMeta, recordTest } from "@/lib/db/repo";
import { resetMemoryStore } from "@/lib/db/mongo";
import { hashPassword, issueToken, signIn, signUp, verifyPassword, verifyToken } from "@/lib/security/auth";
import { open } from "@/lib/security/crypto";
import { initialStages } from "@/lib/audit/orchestrator";
import type { AuditDoc } from "@/lib/types";

beforeEach(() => resetMemoryStore());

const audit = (id: string, ownerId: string, url = "https://example.com/p"): AuditDoc => ({
  auditId: id, ownerId, schemaVersion: 2, targetUrl: url, normalizedTargetUrl: "example.com/p", queries: [{ text: "secret query", source: "user" }],
  settings: { verification: "off" }, status: "completed", cancelRequested: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), stages: initialStages(), log: [],
});

describe("passwords", () => {
  it("hashes with a per-user salt and verifies", async () => {
    const h1 = await hashPassword("correct horse battery");
    const h2 = await hashPassword("correct horse battery");
    expect(h1).not.toBe(h2);
    expect(h1).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", h1)).toBe(true);
    expect(await verifyPassword("wrong password!!", h1)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("sign up / sign in", () => {
  it("creates an account, normalises email, rejects duplicates and weak input", async () => {
    const r = await signUp("  Ada@Example.COM ", "a-long-password-1");
    expect("user" in r).toBe(true);
    expect(await signUp("ada@example.com", "another-long-password")).toEqual({ error: expect.stringMatching(/already exists/) });
    expect(await signUp("not-an-email", "a-long-password-1")).toEqual({ error: expect.stringMatching(/valid email/) });
    expect(await signUp("b@example.com", "short")).toEqual({ error: expect.stringMatching(/10 characters/) });
  });
  it("signs in with the right password only; unknown email and wrong password are indistinguishable", async () => {
    await signUp("ada@example.com", "a-long-password-1");
    expect(await signIn("ADA@example.com", "a-long-password-1")).toMatchObject({ userId: expect.any(String) });
    expect(await signIn("ada@example.com", "nope-nope-nope")).toBeNull();
    expect(await signIn("ghost@example.com", "a-long-password-1")).toBeNull();
  });
});

describe("session tokens", () => {
  it("round-trips a user id and rejects tampering, other users and expiry", () => {
    const { value } = issueToken("user1");
    expect(verifyToken(value)).toEqual({ userId: "user1" });
    const [, exp, sig] = value.split(".");
    expect(verifyToken(`user2.${exp}.${sig}`)).toBeNull(); // cannot re-target a signature at another user
    expect(verifyToken(`user1.1.${sig}`)).toBeNull();
    expect(verifyToken(value.slice(0, -2) + "xx")).toBeNull();
    expect(verifyToken(undefined)).toBeNull();
  });
});

describe("tenant isolation", () => {
  it("one user cannot read, list or delete another user's audits", async () => {
    await createAudit(audit("aaaaaaaaaaaaaaaa", "alice"));
    await createAudit(audit("bbbbbbbbbbbbbbbb", "bob", "https://bob.example/x"));
    expect(await getAudit("aaaaaaaaaaaaaaaa", "alice")).not.toBeNull();
    expect(await getAudit("aaaaaaaaaaaaaaaa", "bob")).toBeNull();
    expect((await listAudits("bob", {})).items.map((a) => a.auditId)).toEqual(["bbbbbbbbbbbbbbbb"]);
    expect((await listAudits("bob", { q: "secret query" })).total).toBe(1); // search never crosses accounts
    expect(await deleteAudit("aaaaaaaaaaaaaaaa", "bob")).toBe(false);
    expect(await getAudit("aaaaaaaaaaaaaaaa", "alice")).not.toBeNull();
    expect(await deleteAudit("aaaaaaaaaaaaaaaa", "alice")).toBe(true);
  });
  it("settings and integration test results are per user", async () => {
    await updateSettings("alice", { retentionDays: 30 });
    expect((await getSettings("alice")).retentionDays).toBe(30);
    expect((await getSettings("bob")).retentionDays).toBe(0);
    await recordTest("alice", "tinyfish", "search", { ok: true, message: "ok" });
    expect(await getIntegrationMeta("bob", "tinyfish")).toBeNull();
  });
});

describe("per-user API keys", () => {
  it("each user stores and uses only their own key; ciphertext is bound to the owner", async () => {
    expect(canSaveCredentials().ok).toBe(true);
    await saveCredential("alice", "tinyfish", "alice-secret-key-1111");
    await saveCredential("bob", "tinyfish", "bob-secret-key-2222");
    expect(await getCredential("alice", "tinyfish")).toBe("alice-secret-key-1111");
    expect(await getCredential("bob", "tinyfish")).toBe("bob-secret-key-2222");
    expect(await getCredential("carol", "tinyfish")).toBeNull(); // no shared fallback key
    expect(await credentialStatus("alice", "tinyfish")).toEqual({ configured: true, source: "saved", hint: "…1111" });
    // Copy alice's ciphertext into bob's slot: it must NOT decrypt (AAD = user:provider).
    const a = (await getSecret("alice", "tinyfish"))!;
    await putSecret({ ...a, userId: "mallory" });
    expect(await getCredential("mallory", "tinyfish")).toBeNull();
    expect(() => open(a, "mallory:tinyfish")).toThrow();
    await clearCredential("alice", "tinyfish");
    expect(await getCredential("alice", "tinyfish")).toBeNull();
    expect(await getCredential("bob", "tinyfish")).toBe("bob-secret-key-2222");
  });
  it("never stores plaintext", async () => {
    await saveCredential("alice", "gemini", "AIza-plaintext-must-not-appear");
    expect(JSON.stringify(await getSecret("alice", "gemini"))).not.toContain("plaintext-must-not-appear");
  });
});
