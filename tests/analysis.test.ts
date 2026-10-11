import { describe, expect, it } from "vitest";
import { analyzeDeterministic } from "@/lib/analysis";
import { analyzeRobots, evaluate, parseRobots } from "@/lib/analysis/robots";
import { parseHeadings, extractFromFetch } from "@/lib/analysis/extract";
import { buildGap } from "@/lib/analysis/compare";
import { prioritize } from "@/lib/analysis/findings";
import { runSeoChecks } from "@/lib/analysis/seo";
import { headingsMissingFromFetch } from "@/lib/tinyfish/browser";
import { TARGET, browserPayload, fetchPayload, searchPayload } from "./fixtures";

const base = { auditId: "a1", targetUrl: TARGET, queries: [{ text: "product analytics pricing", source: "user" as const }] };
const check = (cs: ReturnType<typeof runSeoChecks>, id: string) => cs.find((c) => c.checkId === id)!;

describe("extraction", () => {
  it("parses headings and ignores fenced code", () => {
    const h = parseHeadings("# A\n```\n# not a heading\n```\n## B ##\ntext\n### C");
    expect(h).toEqual([{ level: 1, text: "A" }, { level: 2, text: "B" }, { level: 3, text: "C" }]);
  });
  it("extracts prices, email, phone and link counts", () => {
    const x = extractFromFetch(fetchPayload());
    expect(x.facts.map((f) => f.value)).toEqual(expect.arrayContaining(["$29/mo", "$99/mo", "sales@acme-metrics.example.com"]));
    expect(x.internalLinks).toBe(2);
    expect(x.externalLinks).toBe(1);
  });
  it("reports null link counts when Fetch returned none (not zero)", () => {
    expect(extractFromFetch(fetchPayload({ links: null })).internalLinks).toBeNull();
  });
});

describe("robots.txt", () => {
  const body = `User-agent: *\nDisallow: /private/\nAllow: /private/public\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: https://x.com/sm.xml`;
  it("longest match wins, Allow beats Disallow on ties", () => {
    const { groups } = parseRobots(body);
    expect(evaluate(groups, "*", "/private/x", { fallbackToStar: true }).allowed).toBe(false);
    expect(evaluate(groups, "*", "/private/public", { fallbackToStar: true }).allowed).toBe(true);
    expect(evaluate(groups, "*", "/pricing", { fallbackToStar: true }).allowed).toBe(true);
  });
  it("flags named AI bots separately from the wildcard", () => {
    const r = analyzeRobots(body, "https://x.com/pricing");
    expect(r.genericDisallowsPath).toBe(false);
    expect(r.aiBotDisallows).toEqual(["GPTBot"]);
    expect(r.sitemaps).toEqual(["https://x.com/sm.xml"]);
  });
  it("supports wildcard and end anchors", () => {
    const { groups } = parseRobots("User-agent: *\nDisallow: /*.pdf$");
    expect(evaluate(groups, "*", "/a/b.pdf", { fallbackToStar: true }).allowed).toBe(false);
    expect(evaluate(groups, "*", "/a/b.pdf?x=1", { fallbackToStar: true }).allowed).toBe(true);
  });
  it("detects a wildcard block of the target path", () => {
    expect(analyzeRobots("User-agent: *\nDisallow: /pricing", TARGET).genericDisallowsPath).toBe(true);
  });
});

describe("technical checks", () => {
  it("passes a healthy page and marks unobserved items not_checked, never pass", () => {
    const cs = runSeoChecks({ targetUrl: TARGET, fetch: { evidenceId: "ev_fetch_1", payload: fetchPayload() } });
    expect(check(cs, "title").status).toBe("pass");
    expect(check(cs, "canonical").status).toBe("pass");
    expect(check(cs, "robots_meta").status).toBe("pass");
    expect(check(cs, "structured_data").status).toBe("not_checked");
    expect(check(cs, "robots_txt").status).toBe("not_checked");
    expect(check(cs, "broken_links").status).toBe("not_checked");
  });
  it("fails on noindex", () => {
    const cs = runSeoChecks({ targetUrl: TARGET, fetch: { evidenceId: "e", payload: fetchPayload({ pageMetadata: { robots: "noindex, nofollow" } }) } });
    expect(check(cs, "robots_meta").status).toBe("fail");
  });
  it("does not claim anything when Fetch failed", () => {
    const cs = runSeoChecks({ targetUrl: TARGET, fetch: { evidenceId: "e", payload: fetchPayload({ text: "", error: { code: "bot_blocked", message: "x" } }) } });
    expect(check(cs, "title").status).toBe("not_checked");
    expect(check(cs, "content_volume").status).toBe("not_checked");
  });
  it("only evaluates JSON-LD when browser evidence exists", () => {
    const cs = runSeoChecks({
      targetUrl: TARGET,
      fetch: { evidenceId: "f", payload: fetchPayload() },
      browser: { evidenceId: "b", payload: browserPayload({ jsonLd: [{ valid: false, types: [], sample: "{" }] }) },
    });
    expect(check(cs, "structured_data").status).toBe("fail");
  });
  it("warns on a canonical pointing elsewhere", () => {
    const cs = runSeoChecks({ targetUrl: TARGET, fetch: { evidenceId: "f", payload: fetchPayload({ pageMetadata: { canonical: "https://other.com/x" } }) } });
    expect(check(cs, "canonical").status).toBe("warning");
  });
  it("sitemap: unknown for an index, warning when absent from a full sitemap", () => {
    const f = { evidenceId: "f", payload: fetchPayload() };
    const idx = runSeoChecks({ targetUrl: TARGET, fetch: f, sitemap: { evidenceId: "s", payload: { url: "u", status: 200, isIndex: true, listsTarget: null, urlCount: 3 } } });
    expect(check(idx, "sitemap").status).toBe("unknown");
    const miss = runSeoChecks({ targetUrl: TARGET, fetch: f, sitemap: { evidenceId: "s", payload: { url: "u", status: 200, isIndex: false, listsTarget: false, urlCount: 40 } } });
    expect(check(miss, "sitemap").status).toBe("warning");
  });
});

describe("gap analysis", () => {
  it("measures query term coverage", () => {
    const g = buildGap({ query: "product analytics pricing", fetch: fetchPayload(), search: searchPayload(), targetUrl: TARGET, evidence: { search: "s", fetch: "f" } });
    const row = (t: string) => g.coverage.find((c) => c.term === t)!;
    expect(row("pricing").inTitle).toBe(true);
    expect(row("analytic").inBody || row("analytics").inBody).toBe(true);
  });
  it("lists competitor terms the page never states", () => {
    const g = buildGap({ query: "product analytics pricing", fetch: fetchPayload(), search: searchPayload(), targetUrl: TARGET, evidence: {} });
    expect(g.competitorTerms.map((t) => t.term)).toContain("billing");
  });
  it("notes missing evidence rather than inventing coverage", () => {
    const g = buildGap({ query: "x query", fetch: null, search: null, targetUrl: TARGET, evidence: {} });
    expect(g.notes.length).toBeGreaterThan(0);
    expect(g.coverage.every((c) => !c.inBody)).toBe(true);
  });
});

describe("deterministic findings", () => {
  it("labels a miss as 'Not found in checked results' (never 'not indexed')", () => {
    const r = analyzeDeterministic({ ...base, searches: [{ evidenceId: "s1", payload: searchPayload({ match: null }) }], fetch: { evidenceId: "f1", payload: fetchPayload() } });
    const f = r.findings.find((x) => x.category === "discovery")!;
    expect(f.title).toMatch(/Not found in checked results/);
    expect(JSON.stringify(f)).not.toMatch(/not indexed/i);
    expect(f.evidenceRefs).toContain("s1");
    expect(f.severity).not.toBe("critical");
  });
  it("raises critical only for confirmed access problems", () => {
    const r = analyzeDeterministic({ ...base, searches: [], fetch: { evidenceId: "f1", payload: fetchPayload({ text: "", textLength: 0, title: null, error: { code: "bot_blocked", message: "bot challenge" } }) } });
    expect(r.findings[0]!.severity).toBe("critical");
    expect(r.findings[0]!.verificationStatus).toBe("confirmed");
    expect(r.findings[0]!.explanation).toMatch(/not proof/);
  });
  it("a timeout is only a low-confidence potential issue", () => {
    const r = analyzeDeterministic({ ...base, searches: [], fetch: { evidenceId: "f1", payload: fetchPayload({ text: "", error: { code: "timeout", message: "t" } }) } });
    expect(r.findings[0]).toMatchObject({ severity: "medium", confidence: "low", verificationStatus: "potential" });
  });
  it("confirms render gaps only with browser evidence", () => {
    const f = { evidenceId: "f1", payload: fetchPayload({ text: "", textLength: 0, error: { code: "empty_content", message: "e" } }) };
    const without = analyzeDeterministic({ ...base, searches: [], fetch: f });
    expect(without.findings[0]).toMatchObject({ severity: "high", verificationStatus: "needs_browser" });
    const withB = analyzeDeterministic({ ...base, searches: [], fetch: f, browser: { evidenceId: "b1", payload: browserPayload() } });
    expect(withB.findings[0]).toMatchObject({ verificationStatus: "confirmed", confidence: "high" });
    expect(withB.findings[0]!.evidenceRefs).toEqual(["f1", "b1"]);
  });
  it("reports headings visible in the browser but missing from Fetch", () => {
    const b = browserPayload({ missingFromFetch: ["Enterprise pricing", "Compare plans"] });
    const r = analyzeDeterministic({ ...base, searches: [], fetch: { evidenceId: "f1", payload: fetchPayload() }, browser: { evidenceId: "b1", payload: b } });
    expect(r.findings.some((f) => /missing from Fetch/.test(f.title) && f.verificationStatus === "confirmed")).toBe(true);
  });
  it("robots.txt wildcard block is critical and cites the rule", () => {
    const robots = { evidenceId: "r1", payload: { url: "u", status: 200, bodySample: "", genericDisallowsPath: true, matchedRule: "Disallow: /pricing", aiBotDisallows: [], sitemaps: [] } };
    const r = analyzeDeterministic({ ...base, searches: [], fetch: { evidenceId: "f1", payload: fetchPayload() }, robots });
    expect(r.findings[0]).toMatchObject({ severity: "critical", evidenceRefs: ["r1"] });
  });
  it("assigns sequential ids after prioritisation", () => {
    const r = analyzeDeterministic({ ...base, searches: [{ evidenceId: "s1", payload: searchPayload({ match: null }) }], fetch: { evidenceId: "f1", payload: fetchPayload({ title: null, description: null }) } });
    expect(r.findings.map((f) => f.findingId)).toEqual(r.findings.map((_, i) => `F-${String(i + 1).padStart(3, "0")}`));
  });
});

describe("prioritize", () => {
  it("orders by severity, then confidence, stably", () => {
    const l = prioritize([
      { id: 1, severity: "low", confidence: "high" },
      { id: 2, severity: "high", confidence: "low" },
      { id: 3, severity: "high", confidence: "high" },
      { id: 4, severity: "critical", confidence: "low" },
      { id: 5, severity: "high", confidence: "high" },
    ] as never[]);
    expect(l.map((x: { id: number }) => x.id)).toEqual([4, 3, 5, 2, 1]);
  });
});

describe("browser comparison", () => {
  it("lists rendered headings absent from the fetch text", () => {
    const miss = headingsMissingFromFetch([{ level: 2, text: "Starter" }, { level: 2, text: "Enterprise plan" }, { level: 5, text: "tiny" }], "## Starter\nstuff");
    expect(miss).toEqual(["Enterprise plan"]);
  });
});
