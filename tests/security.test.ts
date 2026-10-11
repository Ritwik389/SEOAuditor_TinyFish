import { describe, expect, it } from "vitest";
import { redact, redactObject } from "@/lib/security/redact";
import { open, seal, encryptionAvailable } from "@/lib/security/crypto";

describe("redact", () => {
  it("removes mongodb URIs, api keys and bearer tokens", () => {
    const s = redact("connect mongodb+srv://user:pass@cluster0.x.mongodb.net/db failed; x-api-key: tf_abc123456789; Bearer abcdefghijklmnop; ?key=AIzaSyA1234567890123456789012345");
    expect(s).not.toMatch(/user:pass|tf_abc|abcdefghijklmnop|AIzaSy/);
    expect(s).toContain("[REDACTED");
  });
  it("redacts secret-looking object keys recursively", () => {
    const o = redactObject({ ok: 1, apiKey: "secret", nested: { mongoUri: "mongodb://x", note: "hello" } });
    expect(o).toEqual({ ok: 1, apiKey: "[REDACTED]", nested: { mongoUri: "[REDACTED]", note: "hello" } });
  });
});

describe("credential encryption", () => {
  it("round-trips and binds to the provider (AAD)", () => {
    expect(encryptionAvailable()).toBe(true);
    const s = seal("my-secret-key", "tinyfish");
    expect(s.ct).not.toContain("my-secret");
    expect(open(s, "tinyfish")).toBe("my-secret-key");
    expect(() => open(s, "gemini")).toThrow();
  });
  it("detects tampering", () => {
    const s = seal("abc12345", "gemini");
    const buf = Buffer.from(s.ct, "base64");
    buf[0] = buf[0]! ^ 1;
    expect(() => open({ ...s, ct: buf.toString("base64") }, "gemini")).toThrow();
  });
});

describe("rate limiting", () => {
  it("allows up to the limit then returns seconds to wait", async () => {
    const { rateLimit } = await import("@/lib/api");
    const k = `t-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(k, 3, 60_000)).toBeNull();
    const wait = rateLimit(k, 3, 60_000);
    expect(wait).toBeGreaterThan(0);
    expect(rateLimit(`other-${k}`, 3, 60_000)).toBeNull();
  });
});


describe("encryption key forms", () => {
  it("accepts a 32-byte base64 key, derives from any 32+ char secret, rejects short ones", async () => {
    const { seal, open, encryptionAvailable } = await import("@/lib/security/crypto");
    const prev = process.env.CREDENTIAL_ENCRYPTION_KEY;
    try {
      process.env.CREDENTIAL_ENCRYPTION_KEY = "x".repeat(62); // decodes to 46 bytes: previously rejected, now stretched
      expect(encryptionAvailable()).toBe(true);
      expect(open(seal("secret-value", "u:tinyfish"), "u:tinyfish")).toBe("secret-value");
      process.env.CREDENTIAL_ENCRYPTION_KEY = "short";
      expect(encryptionAvailable()).toBe(false);
      process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
      expect(encryptionAvailable()).toBe(true);
    } finally {
      process.env.CREDENTIAL_ENCRYPTION_KEY = prev;
    }
  });
});
