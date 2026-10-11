import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { canTransition, defaultDeps, reconcileStale, runAudit, browserObjective, type Deps } from "@/lib/audit/orchestrator";
import { createAuditFromInput } from "@/lib/audit/create";
import { getAudit, listEvidence, listFindings, patchAudit } from "@/lib/db/repo";
import { resetMemoryStore } from "@/lib/db/mongo";
import { TinyFishError } from "@/lib/tinyfish/client";
import type { AnalysisProvider } from "@/lib/gemini/provider";
import type { BrowserPayload } from "@/lib/types";
import { fetchPayload, browserPayload, TARGET } from "./fixtures";
import { defaultMockState, startMock, type Mock } from "./mock-servers";

// The URL guard is covered in ssrf.test.ts. Here we only need local mock hosts to be auditable.
beforeAll(() => {
  process.env.SNIFFSITE_ALLOW_PRIVATE_TARGETS = "1";
});
afterAll(() => {
  delete process.env.SNIFFSITE_ALLOW_PRIVATE_TARGETS;
});
beforeEach(() => resetMemoryStore());

const searchOutcome = (hit = true) => ({
  query: "product analytics pricing", page: 0, totalResults: 3, requestId: "r", latencyMs: 5,
  results: [
    { position: 1, title: "Mixpanel pricing", url: "https://mixpanel.com/pricing", snippet: "event based billing", siteName: "mixpanel.com" },
    ...(hit ? [{ position: 2, title: "Acme Metrics pricing", url: TARGET, snippet: "Plans start at $29/mo", siteName: "acme" }] : []),
  ],
});
const fetchOutcome = (over = {}) => ({ payload: fetchPayload(over), requestId: "r", latencyMs: 9 });
const browserOutcome = (over: Partial<BrowserPayload> = {}) => ({ payload: browserPayload(over), sessionId: "s", requestId: "r" });

function deps(over: Partial<Deps> = {}): Deps {
  return {
    ...defaultDeps,
    search: vi.fn(async () => searchOutcome()),
    fetch: vi.fn(async () => fetchOutcome()),
    browser: vi.fn(async () => browserOutcome()),
    siteFiles: vi.fn(async () => ({
      robots: { url: "u", status: 404, bodySample: "", genericDisallowsPath: null, aiBotDisallows: [], sitemaps: [] },
      sitemap: null,
    })),
    provider: async () => null,
    apiKey: async () => "test-key",
    settings: async () => ({ geminiModel: "gemini-3.8-flash", defaultVerification: "auto", retentionDays: 0, maxEvidenceChars: 80_000 }),
    ...over,
  } as Deps;
}

const make = (over: Record<string, unknown> = {}) =>
  createAuditFromInput({ url: TARGET, queries: [{ text: "product analytics pricing", source: "user" }], verification: "auto", ...over } as never, "u1");

const stage = (a: { stages: { stageId: string; status: string }[] }, id: string) => a.stages.find((s) => s.stageId === id)!;

describe("happy path", () => {
  it("runs every stage with real status, persists evidence + findings, counts API calls", async () => {
    const a = await make();
    const d = deps();
    await runAudit(a.auditId, d);
    const r = (await getAudit(a.auditId, null))!;
    expect(r.status).toBe("completed");
    expect(stage(r, "search").status).toBe("completed");
    expect(stage(r, "fetch").status).toBe("completed");
    expect(stage(r, "browser_verify").status).toBe("skipped"); // no objective
    expect(stage(r, "recommendations").status).toBe("skipped"); // Gemini not configured
    expect(stage(r, "save").status).toBe("completed");
    expect(r.stages.every((s) => ["completed", "skipped"].includes(s.status))).toBe(true);
    expect(r.summary).toMatchObject({ search: "found", searchPosition: 2, fetch: "ok", browser: "skipped", semanticAnalysis: "unavailable", apiCalls: { search: 1, fetch: 1, browser: 0, gemini: 0 } });
    const ev = await listEvidence(a.auditId);
    expect(ev.map((e) => e.evidenceId)).toEqual(expect.arrayContaining(["ev_search_1", "ev_fetch_1", "ev_robots_1"]));
    expect(ev.find((e) => e.sourceType === "fetch")!.retrieval).toBe("live-or-cache");
    const f = await listFindings(a.auditId);
    expect(f.length).toBe(r.summary!.findingsCount);
    for (const finding of f) for (const ref of finding.evidenceRefs) expect(ev.some((e) => e.evidenceId === ref)).toBe(true);
    expect(d.search).toHaveBeenCalledTimes(1);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.browser).not.toHaveBeenCalled();
  });

  it("is fetch-only (search skipped, not faked) when no query is given", async () => {
    const a = await make({ queries: [] });
    const d = deps();
    await runAudit(a.auditId, d);
    const r = (await getAudit(a.auditId, null))!;
    expect(stage(r, "search").status).toBe("skipped");
    expect(r.summary!.search).toBe("not_run");
    expect(d.search).not.toHaveBeenCalled();
  });

  it("revalidates the redirect target: inspect step matches via final URL", async () => {
    const a = await make();
    const d = deps({
      search: vi.fn(async () => ({ ...searchOutcome(false), results: [{ position: 4, title: "Plans", url: "https://acme.example.com/plans", snippet: "", siteName: "" }] })),
      fetch: vi.fn(async () => fetchOutcome({ finalUrl: "https://acme.example.com/plans" })),
    });
    await runAudit(a.auditId, d);
    expect((await getAudit(a.auditId, null))!.summary).toMatchObject({ search: "found", searchPosition: 4 });
    expect((await listEvidence(a.auditId)).find((e) => e.sourceType === "search")!.normalizedPayload).toMatchObject({ match: { method: "final-url" } });
  });
});

describe("partial failures keep useful evidence", () => {
  it("search failure => partial report with fetch evidence and findings", async () => {
    const a = await make();
    await runAudit(a.auditId, deps({ search: vi.fn(async () => { throw new TinyFishError("TinyFish is temporarily unavailable.", 503, "SERVICE_BUSY", true); }) }));
    const r = (await getAudit(a.auditId, null))!;
    expect(r.status).toBe("partial");
    expect(stage(r, "search").status).toBe("failed");
    expect(stage(r, "fetch").status).toBe("completed");
    expect(r.summary!.search).toBe("failed");
    expect((await listEvidence(a.auditId)).some((e) => e.sourceType === "fetch")).toBe(true);
    expect(r.log.some((l) => l.stageId === "search" && l.level === "error")).toBe(true);
  });

  it("fetch bot_blocked => partial with a critical confirmed finding and auto browser verification", async () => {
    const a = await make();
    const d = deps({ fetch: vi.fn(async () => fetchOutcome({ text: "", textLength: 0, title: null, description: null, pageMetadata: null, links: null, error: { code: "bot_blocked", message: "bot challenge" } })) });
    await runAudit(a.auditId, d);
    const r = (await getAudit(a.auditId, null))!;
    expect(r.status).toBe("partial");
    expect(d.browser).toHaveBeenCalledTimes(1);
    expect(r.summary!.browser).toBe("verified");
    const f = await listFindings(a.auditId);
    expect(f[0]).toMatchObject({ severity: "critical", verificationStatus: "confirmed" });
    expect(stage(r, "extract").status).toBe("skipped");
  });

  it("everything failing => 'failed' with no fabricated findings", async () => {
    const a = await make();
    const boom = () => { throw new TinyFishError("down", 503, "SERVICE_BUSY", true); };
    await runAudit(a.auditId, deps({ search: vi.fn(async () => boom()), fetch: vi.fn(async () => boom()) }));
    const r = (await getAudit(a.auditId, null))!;
    expect(r.status).toBe("failed");
    expect(r.errorSummary).toMatch(/No usable evidence/);
    expect((await listFindings(a.auditId))).toHaveLength(0);
  });

  it("browser not entitled (403) => verification 'unavailable', audit still delivers", async () => {
    const a = await make({ verification: "always" });
    const d = deps({ browser: vi.fn(async () => { throw new TinyFishError("not enabled", 403, "FORBIDDEN", false); }) });
    await runAudit(a.auditId, d);
    const r = (await getAudit(a.auditId, null))!;
    expect(r.status).toBe("partial");
    expect(r.summary!.browser).toBe("unavailable");
    expect(r.summary!.findingsCount).toBeGreaterThan(-1);
    expect(stage(r, "recommendations").status).not.toBe("failed");
  });

  it("verification off never calls Browser even when Fetch is empty", async () => {
    const a = await make({ verification: "off" });
    const d = deps({ fetch: vi.fn(async () => fetchOutcome({ text: "", error: { code: "empty_content", message: "e" } })) });
    await runAudit(a.auditId, d);
    expect(d.browser).not.toHaveBeenCalled();
    expect(stage((await getAudit(a.auditId, null))!, "browser_verify").status).toBe("skipped");
  });

  it("semantic failure keeps deterministic findings and marks the stage failed", async () => {
    const a = await make();
    const provider: AnalysisProvider = { id: "t", model: "t", generateJson: async () => "garbage" };
    await runAudit(a.auditId, deps({ provider: async () => provider }));
    const r = (await getAudit(a.auditId, null))!;
    expect(stage(r, "recommendations").status).toBe("failed");
    expect(r.status).toBe("partial");
    expect(r.summary!.semanticAnalysis).toBe("failed");
    expect((await listFindings(a.auditId)).every((f) => f.origin === "deterministic")).toBe(true);
  });

  it("valid semantic output is merged with verified excerpts only", async () => {
    const a = await make();
    const out = {
      gap: { searchCommunicates: "Price from $29", pageExplains: "Plans and prices", purposeMatch: "yes", purposeRationale: "matches", snippetOmissions: [], evidenceRefs: ["ev_fetch_1"] },
      entities: [],
      findings: [{ title: "Plans lack target audience", severity: "medium", confidence: "medium", category: "messaging", explanation: "No audience statement near the plans.", whyItMatters: "Buyers self-select by team size.", evidenceRefs: ["ev_fetch_1"], excerpts: [{ evidenceId: "ev_fetch_1", text: "Starter costs $29/mo and includes 10,000 events" }, { evidenceId: "ev_fetch_1", text: "invented quote that is not on the page" }], recommendedAction: "Add audience line.", expectedOutcome: "Clearer.", verificationMethod: "Re-run.", verificationStatus: "observed" }],
    };
    const provider: AnalysisProvider = { id: "t", model: "gemini-test", generateJson: async () => JSON.stringify(out) };
    await runAudit(a.auditId, deps({ provider: async () => provider }));
    const r = (await getAudit(a.auditId, null))!;
    expect(r.summary!.semanticAnalysis).toBe("used");
    expect(r.summary!.apiCalls.gemini).toBe(1);
    expect(r.summary!.gaps[0]).toMatchObject({ source: "deterministic+semantic", purposeMatch: "yes" });
    const sem = (await listFindings(a.auditId)).find((f) => f.origin === "semantic")!;
    expect(sem.excerpts).toHaveLength(1);
    expect(sem.excerpts[0]!.text).toMatch(/Starter costs/);
  });
});

describe("configuration, idempotency and cancellation", () => {
  it("waits for configuration when the TinyFish key is missing (no calls made)", async () => {
    const a = await make();
    const d = deps({ apiKey: async () => null });
    await runAudit(a.auditId, d);
    const r = (await getAudit(a.auditId, null))!;
    expect(r.status).toBe("waiting_config");
    expect(stage(r, "search").status).toBe("waiting_config");
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("two concurrent invocations run the audit once (atomic claim)", async () => {
    const a = await make();
    const d = deps();
    await Promise.all([runAudit(a.auditId, d), runAudit(a.auditId, d)]);
    expect(d.search).toHaveBeenCalledTimes(1);
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });

  it("cancellation aborts in-flight requests and leaves no stage 'running'", async () => {
    const a = await make();
    const slowFetch = vi.fn((_k: string, p: { signal?: AbortSignal }) => new Promise<never>((_, rej) => p.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")))));
    const run = runAudit(a.auditId, deps({ fetch: slowFetch as never }));
    await vi.waitFor(async () => expect(stage((await getAudit(a.auditId, null))!, "fetch").status).toBe("running"));
    await patchAudit(a.auditId, { cancelRequested: true });
    await run;
    const r = (await getAudit(a.auditId, null))!;
    expect(r.status).toBe("cancelled");
    expect(r.stages.some((s) => s.status === "running" || s.status === "queued")).toBe(false);
    expect(r.completedAt).toBeTruthy();
  });

  it("cancelling a queued audit prevents it from starting", async () => {
    const a = await make();
    await patchAudit(a.auditId, { status: "cancelled", cancelRequested: true });
    const d = deps();
    await runAudit(a.auditId, d);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("reconcileStale fails audits whose function died", async () => {
    const a = await make();
    await patchAudit(a.auditId, { status: "running" });
    const old = { ...(await getAudit(a.auditId, null))!, updatedAt: new Date(Date.now() - 10 * 60_000).toISOString() };
    const r = await reconcileStale(old);
    expect(r.status).toBe("failed");
    expect(r.stages.some((s) => s.status === "queued" || s.status === "running")).toBe(false);
    expect((await getAudit(a.auditId, null))!.status).toBe("failed");
  });
});

describe("status transitions", () => {
  it("allows only legal moves and never leaves a terminal state", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "partial")).toBe(true);
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("cancelled", "running")).toBe(false);
    expect(canTransition("failed", "completed")).toBe(false);
    expect(canTransition("queued", "completed")).toBe(false);
  });
});

describe("browser objective", () => {
  const f = (o = {}) => fetchPayload(o);
  it("is null when evidence is sufficient, concrete when it is not", () => {
    expect(browserObjective("auto", f())).toBeNull();
    expect(browserObjective("off", f({ error: { code: "empty_content", message: "" } }))).toBeNull();
    expect(browserObjective("auto", f({ error: { code: "empty_content", message: "" } }))).toMatch(/empty_content/);
    expect(browserObjective("auto", f({ error: { code: "page_not_found", message: "" } }))).toBeNull();
    expect(browserObjective("auto", f({ text: "short text", textLength: 10 }))).toMatch(/only/);
    expect(browserObjective("always", f())).toMatch(/requested/);
  });
});

describe("real adapters against the local mock + full pipeline", () => {
  let mock: Mock;
  beforeAll(async () => {
    mock = await startMock();
    process.env.TINYFISH_SEARCH_URL = `${mock.base}/search`;
    process.env.TINYFISH_FETCH_URL = `${mock.base}/fetch`;
  });
  afterAll(() => mock.close());

  it("runs end-to-end through the HTTP adapters, robots.txt and sitemap", async () => {
    Object.assign(mock.state, defaultMockState());
    mock.site.set("/robots.txt", { body: "User-agent: *\nAllow: /\nUser-agent: GPTBot\nDisallow: /pricing\nSitemap: __ORIGIN__/sitemap.xml" });
    mock.site.set("/sitemap.xml", { type: "application/xml", body: `<urlset><url><loc>__ORIGIN__/pricing</loc></url><url><loc>__ORIGIN__/docs</loc></url></urlset>` });
    const a = await createAuditFromInput({ url: `${mock.base}/pricing`, queries: [{ text: "product analytics pricing", source: "user" }], verification: "off" } as never, "u1");
    await runAudit(a.auditId, { ...defaultDeps, provider: async () => null, apiKey: async () => "test-key" });
    const r = (await getAudit(a.auditId, null))!;
    expect(r.status).toBe("completed");
    expect(r.summary).toMatchObject({ search: "found", fetch: "ok" });
    const checks = Object.fromEntries(r.summary!.checks.map((c) => [c.checkId, c]));
    expect(checks.sitemap!.status).toBe("pass");
    expect(checks.robots_txt!.status).toBe("warning"); // GPTBot-specific disallow
    expect(checks.robots_txt!.observed).toMatch(/GPTBot/);
    expect(mock.state.requests.filter((q) => q.path.startsWith("/search"))).toHaveLength(1);
    expect(mock.state.requests.filter((q) => q.path === "/fetch")).toHaveLength(1);
  });
});

describe("memory store emulator parity with MongoDB upsert semantics", () => {
  it("applies dotted $set paths as nested fields on upsert", async () => {
    const { recordTest, getIntegrationMeta } = await import("@/lib/db/repo");
    await recordTest("u1", "mongodb", "readwrite", { ok: true, message: "ok" });
    await recordTest("u1", "mongodb", "other", { ok: false, message: "no" });
    const m = await getIntegrationMeta("u1", "mongodb");
    expect(Object.keys(m!.tests!).sort()).toEqual(["other", "readwrite"]);
    expect(m!.tests!.readwrite!.ok).toBe(true);
  });
});
