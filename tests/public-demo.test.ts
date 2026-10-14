import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/public-audits/route";
import { POST as proposal } from "@/app/api/public-query-proposal/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { getAudit, listAudits } from "@/lib/db/repo";
import { withDemoDb } from "@/lib/db/demo-context";
import { resetMemoryStore } from "@/lib/db/mongo";
import { createAuditFromInput } from "@/lib/audit/create";
import { startMock, type Mock } from "./mock-servers";

let mock: Mock;
const ctx = { params: Promise.resolve({}) };
const request = (path: string, body: unknown, signal?: AbortSignal, origin = "https://demo.example") => new Request(`https://demo.example${path}`, {
  method: "POST", headers: { "content-type": "application/json", host: "demo.example", origin, "x-forwarded-for": Math.random().toString() }, body: JSON.stringify(body), signal,
});
const body = () => ({ url: `${mock.base}/page`, queries: [{ text: "product analytics pricing", source: "user" }], verification: "off" });
const events = async (response: Response) => (await response.text()).trim().split("\n").map((line) => JSON.parse(line));

beforeAll(async () => { mock = await startMock(); });
afterAll(async () => { await mock.close(); vi.unstubAllEnvs(); });
beforeEach(() => {
  resetMemoryStore();
  vi.stubEnv("PUBLIC_DEMO_MODE", "true");
  vi.stubEnv("TINYFISH_API_KEY", "test-key");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("SNIFFSITE_ALLOW_PRIVATE_TARGETS", "1");
  vi.stubEnv("TINYFISH_SEARCH_URL", `${mock.base}/search`);
  vi.stubEnv("TINYFISH_FETCH_URL", `${mock.base}/fetch`);
});

describe("public streamed audits", () => {
  it("runs anonymous Search and Fetch, streams real progress and complete evidence without database or secrets", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://unreachable.invalid");
    const response = await POST(request("/api/public-audits", body()), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    const all = await events(response);
    expect(all[0].report.audit.status).toBe("queued");
    expect(all.some((e) => e.report?.audit.status === "running")).toBe(true);
    const final = all.at(-1);
    expect(final.type).toBe("complete");
    expect(final.report.audit.status).toBe("completed");
    expect(final.report.audit.summary.apiCalls).toMatchObject({ search: 1, fetch: 1 });
    expect(final.report.evidence.map((e: { sourceType: string }) => e.sourceType)).toEqual(expect.arrayContaining(["search", "fetch"]));
    expect(final.report.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(all)).not.toContain("test-key");
    expect(await getAudit(final.report.audit.auditId, null)).toBeNull();
  });
  it("isolates concurrent requests, even with the same public owner", async () => {
    const results = await Promise.all([1, 2].map(() => POST(request("/api/public-audits", body()), ctx).then(events)));
    const ids = results.map((es) => es.at(-1).report.audit.auditId);
    expect(ids[0]).not.toBe(ids[1]);
    for (let i = 0; i < 2; i++) expect(results[i]!.every((e) => !e.report || e.report.audit.auditId === ids[i])).toBe(true);
    expect((await listAudits("public-demo", {})).total).toBe(0);
  });
  it("propagates client cancellation and preserves a terminal snapshot", async () => {
    const ctl = new AbortController();
    const response = await POST(request("/api/public-audits", body(), ctl.signal), ctx);
    ctl.abort();
    const final = (await events(response)).at(-1);
    expect(final.report.audit.status).toBe("cancelled");
    expect(final.report.audit.stages.some((s: { status: string }) => s.status === "running")).toBe(false);
  });
  it("requires a configured server key and rejects cross-origin writes", async () => {
    expect((await POST(request("/api/public-audits", body(), undefined, "https://other.example"), ctx)).status).toBe(403);
    vi.stubEnv("TINYFISH_API_KEY", "");
    expect((await POST(request("/api/public-audits", body()), ctx)).status).toBe(503);
    vi.stubEnv("PUBLIC_DEMO_MODE", "false");
    expect((await POST(request("/api/public-audits", body()), ctx)).status).toBe(404);
  });
  it("suggests an explicitly inferred Fetch title when Gemini is unavailable", async () => {
    const response = await proposal(request("/api/public-query-proposal", { url: `${mock.base}/page` }), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ query: expect.stringContaining("Acme"), source: "inferred", model: null });
  });
  it("disables account creation in the live demo", async () => {
    expect((await signup(request("/api/auth/signup", { email: "test@example.com", password: "testpassword123" }), ctx)).status).toBe(410);
  });
  it("scoped workspaces cannot read each other's records", async () => {
    const a = await withDemoDb(() => createAuditFromInput({ ...body(), queries: [], verification: "off" }, "public-demo"));
    expect(await withDemoDb(() => getAudit(a.auditId, null))).toBeNull();
  });
});
