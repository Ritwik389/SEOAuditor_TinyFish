import { describe, expect, it } from "vitest";
import { buildAuditInsights } from "@/lib/analysis/insights";
import type { EvidenceRecord, Finding, ReportData } from "@/lib/types";
import { TARGET, browserPayload, evidenceRecord, fetchPayload, searchPayload } from "./fixtures";

function report(overrides: Partial<ReportData> = {}): ReportData {
  return {
    audit: {
      auditId: "a1", ownerId: "u1", schemaVersion: 2,
      targetUrl: TARGET, normalizedTargetUrl: TARGET,
      queries: [{ text: "product analytics pricing", source: "user" }],
      settings: { verification: "off" }, status: "completed", cancelRequested: false,
      createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z", stages: [], log: [],
    },
    evidence: [], findings: [], ...overrides,
  };
}

const fetchEvidence = (payload = fetchPayload()) => evidenceRecord({ evidenceId: "fetch-1", sourceType: "fetch", normalizedPayload: payload });
const searchEvidence = (payload = searchPayload(), evidenceId = "search-1") => evidenceRecord({ evidenceId, sourceType: "search", normalizedPayload: payload });

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    findingId: "F-001", auditId: "a1", title: "Page title is missing", severity: "high", confidence: "high", category: "metadata", origin: "deterministic",
    explanation: "Fetch returned no title.", whyItMatters: "The page needs a descriptive label.", evidenceRefs: ["fetch-1"], excerpts: [],
    recommendedAction: "Add a descriptive title.", expectedOutcome: "The title can be extracted.", verificationMethod: "Re-run Fetch and inspect the extracted title.",
    verificationStatus: "observed", reportSection: "technical", createdAt: "2026-10-14T00:00:00Z", schemaVersion: 2,
    ...overrides,
  };
}

describe("evidence-grounded audit insights", () => {
  it("keeps absent inputs unmeasured rather than assigning zero coverage or an invented rank", () => {
    const insights = buildAuditInsights(report());
    expect(insights.diagnosis.state).toBe("unmeasured");
    expect(insights.diagnosis.readability).toMatchObject({ state: "unknown", wordCount: null, characters: null });
    expect(insights.diagnosis.visibility).toMatchObject({ state: "unknown", queriesChecked: 0, queriesFound: 0, bestPosition: null });
    expect(insights.queryCoverage[0]).toMatchObject({ bodyPercent: null, titlePercent: null, snippetPercent: null, missingBodyTerms: [] });
    expect(insights.answerReadiness).toMatchObject({ state: "unavailable", cards: [] });
    expect(insights.botAccess[0]!.status).toBe("unknown");
  });

  it("separates a readable page from a miss in a limited Search sample", () => {
    const insights = buildAuditInsights(report({ evidence: [fetchEvidence(), searchEvidence(searchPayload({ match: null }))] }));
    expect(insights.diagnosis.state).toBe("readable_unseen");
    expect(insights.diagnosis.readability.state).toBe("readable");
    expect(insights.diagnosis.visibility.state).toBe("not_found");
    expect(insights.queryCoverage[0]!.bodyPercent).toBe(100);
    expect(insights.queryCoverage[0]!.snippetPercent).toBeNull();
    expect(insights.diagnosis.explanation).not.toMatch(/not indexed|caused|will rank/i);
  });

  it("ignores residual text when Fetch failed while retaining observed Search presence", () => {
    const insights = buildAuditInsights(report({ evidence: [fetchEvidence(fetchPayload({ error: { code: "timeout", message: "Timeout" } })), searchEvidence()] }));
    expect(insights.diagnosis.state).toBe("retrieval_gap");
    expect(insights.diagnosis.visibility).toMatchObject({ state: "found", bestPosition: 2 });
    expect(insights.queryCoverage[0]).toMatchObject({ bodyPercent: null, titlePercent: null, snippetPercent: 67 });
    expect(insights.answerReadiness.cards).toEqual([]);
    expect(insights.diagnosis.limitations.join(" ")).toContain("one retrieval failure");
  });

  it("does not infer Search visibility from a successful Fetch alone", () => {
    const insights = buildAuditInsights(report({ evidence: [fetchEvidence()] }));
    expect(insights.diagnosis.state).toBe("unmeasured");
    expect(insights.diagnosis.visibility.state).toBe("unknown");
    expect(insights.queryCoverage[0]!.bodyPercent).toBe(100);
    expect(insights.queryCoverage[0]!.snippetPercent).toBeNull();
  });

  it("measures term overlap as whole words, preserving short AI terms and singular matches", () => {
    const query = "AI plans pricing";
    const payload = fetchPayload({ title: "AI plan", text: "AI plan information covers repricing examples for regular visitors.", textLength: 70 });
    const data = report({ evidence: [fetchEvidence(payload), searchEvidence(searchPayload({ query, results: [{ position: 2, title: "AI", url: TARGET, snippet: "Plan details", siteName: "acme" }] }))] });
    data.audit.queries = [{ text: query, source: "user" }];
    const coverage = buildAuditInsights(data).queryCoverage[0]!;
    expect(coverage.terms).toEqual(["ai", "plan", "pricing"]);
    expect(coverage).toMatchObject({ bodyPercent: 67, titlePercent: 67, snippetPercent: 33, missingBodyTerms: ["pricing"], missingSnippetTerms: ["ai", "pricing"] });
  });

  it("uses null when an optional query or extracted title is absent", () => {
    const data = report({ evidence: [fetchEvidence(fetchPayload({ title: null }))] });
    expect(buildAuditInsights(data).queryCoverage[0]!.titlePercent).toBeNull();
    data.audit.queries = [];
    const insights = buildAuditInsights(data);
    expect(insights.queryCoverage).toEqual([]);
    expect(insights.answerReadiness.cards).toEqual([]);
    expect(insights.answerReadiness.notes.join(" ")).toContain("Add a target query");
  });

  it("does not count Search title terms as snippet coverage or measure an absent snippet", () => {
    const search = searchPayload({ results: [{ position: 2, title: "Product analytics pricing", url: TARGET, snippet: "Compare costs for your team.", siteName: "acme" }] });
    const data = report({ evidence: [fetchEvidence(), searchEvidence(search)] });
    expect(buildAuditInsights(data).queryCoverage[0]!.snippetPercent).toBe(0);
    search.results[0]!.snippet = "";
    expect(buildAuditInsights(data).queryCoverage[0]!.snippetPercent).toBeNull();
    expect(buildAuditInsights(data).diagnosis.visibility.state).toBe("found");
  });

  it("marks truncated extraction as partial and never treats missing terms as proof of full-page absence", () => {
    const insights = buildAuditInsights(report({ evidence: [fetchEvidence(fetchPayload({ text: "Product analytics facts and more information appear in this captured paragraph.", textTruncated: true })), searchEvidence()] }));
    expect(insights.diagnosis.readability.state).toBe("partial");
    expect(insights.queryCoverage[0]!.missingBodyTerms).toEqual(["pricing"]);
    expect(insights.queryCoverage[0]!.limitations.join(" ")).toContain("does not prove absence");
    expect(insights.answerReadiness.state).toBe("limited");
  });

  it("uses browser evidence to distinguish a render gap from a complete Fetch view", () => {
    const browser = evidenceRecord({ evidenceId: "browser-1", sourceType: "browser", normalizedPayload: browserPayload({ missingFromFetch: ["Enterprise pricing"] }) });
    const insights = buildAuditInsights(report({ evidence: [fetchEvidence(), searchEvidence(), browser] }));
    expect(insights.diagnosis.state).toBe("retrieval_gap");
    expect(insights.diagnosis.readability.evidenceRefs).toEqual(["fetch-1", "browser-1"]);
  });

  it("treats model-produced Agent gaps as leads for verification rather than confirmed incomplete extraction", () => {
    const agent = evidenceRecord({ evidenceId: "agent-1", sourceType: "agent", normalizedPayload: { missingFromFetch: ["An agent-reported answer"] } });
    const insights = buildAuditInsights(report({ evidence: [fetchEvidence(), searchEvidence(), agent] }));
    expect(insights.diagnosis.readability.state).toBe("readable");
    expect(insights.diagnosis.limitations.join(" ")).toContain("not an independent DOM capture");
  });

  it("reports mixed and incomplete queries without converting missing Search evidence into a miss", () => {
    const data = report({ evidence: [fetchEvidence(), searchEvidence(), searchEvidence(searchPayload({ query: "enterprise dashboard", match: null }), "search-2")] });
    data.audit.queries.push({ text: "enterprise dashboard", source: "user" }, { text: "data reports", source: "user" });
    const insights = buildAuditInsights(data);
    expect(insights.diagnosis.visibility).toMatchObject({ state: "partial", queriesChecked: 2, queriesFound: 1, bestPosition: 2 });
    expect(insights.diagnosis.state).toBe("mixed");
    expect(insights.queryCoverage[2]).toMatchObject({ searchPosition: null, resultsChecked: null, snippetPercent: null });
    expect(insights.diagnosis.limitations.join(" ")).toContain("only partly measured");
  });

  it("produces exact, bounded source excerpts and never copies code blocks or fabricates answers", () => {
    const first = "Product analytics pricing starts at $29/mo for teams that need event reports.";
    const second = "The analytics plan includes unlimited dashboards and email support for all users.";
    const source = `# Product analytics pricing\n\n${first}\n${second}\n\n\`\`\`\nProduct analytics pricing is a made-up answer in this code block.\n\`\`\``;
    const insights = buildAuditInsights(report({ evidence: [fetchEvidence(fetchPayload({ text: source })), searchEvidence()] }));
    expect(insights.answerReadiness.state).toBe("extractable");
    expect(insights.answerReadiness.cards[0]!.quote).toBe(first);
    expect(insights.answerReadiness.cards.length).toBeLessThanOrEqual(4);
    for (const card of insights.answerReadiness.cards) {
      expect(source.includes(card.quote)).toBe(true);
      expect(card.quote).not.toContain("made-up");
      expect(card.quote.length).toBeLessThanOrEqual(500);
      expect(card.matchedTerms.length).toBeGreaterThan(0);
      expect(card.evidenceRefs).toEqual(["fetch-1"]);
      expect(card.sourceUrl).toBe(TARGET);
    }
    expect(insights.answerReadiness.notes.join(" ")).toContain("not generated answers");
  });

  it("derives the fix queue from findings and puts unverified hypotheses after observed high impact fixes", () => {
    const data = report({ evidence: [fetchEvidence()], findings: [
      finding({ findingId: "F-001", severity: "critical", verificationStatus: "potential", verificationMethod: "Confirm in a live browser." }),
      finding({ findingId: "F-002", category: "access", recommendedAction: "Restore public access.", verificationStatus: "confirmed" }),
      finding({ findingId: "F-003", severity: "medium", category: "relevance", evidenceRefs: ["fetch-1", "missing-record"] }),
    ] });
    const fixes = buildAuditInsights(data).fixPlan;
    expect(fixes.map((fix) => fix.findingId)).toEqual(["F-002", "F-003", "F-001"]);
    expect(fixes[0]).toMatchObject({ action: "Restore public access.", impact: "access", effort: "moderate", priority: 1 });
    expect(fixes[2]).toMatchObject({ impact: "verification", effort: "investigate", verification: "Confirm in a live browser.", priority: 3 });
    expect(fixes[1]!.evidenceRefs).toEqual(["fetch-1"]);
  });

  it("reports only observed robots policy and does not infer successful bot requests", () => {
    const robots = evidenceRecord({ evidenceId: "robots-1", sourceType: "robots", normalizedPayload: {
      url: "https://acme-metrics.example.com/robots.txt", status: 200, bodySample: "", genericDisallowsPath: false, aiBotDisallows: ["GPTBot"], sitemaps: [],
    } });
    const observations = buildAuditInsights(report({ evidence: [robots] })).botAccess;
    expect(observations[0]).toMatchObject({ status: "no_block_observed", evidenceRefs: ["robots-1"] });
    expect(observations[0]!.note).toContain("does not prove a successful fetch");
    expect(observations[1]).toMatchObject({ agent: "GPTBot", status: "disallowed", evidenceRefs: ["robots-1"] });
    robots.normalizedPayload.status = 503;
    expect(buildAuditInsights(report({ evidence: [robots] })).botAccess).toHaveLength(1);
    expect(buildAuditInsights(report({ evidence: [robots] })).botAccess[0]!.status).toBe("unknown");
  });

  it("does not pretend malformed or unavailable payloads are successful observations", () => {
    const malformed: EvidenceRecord[] = [
      evidenceRecord({ evidenceId: "bad-fetch", sourceType: "fetch", normalizedPayload: null }),
      evidenceRecord({ evidenceId: "bad-search", sourceType: "search", normalizedPayload: { query: "q", results: null } }),
    ];
    const insights = buildAuditInsights(report({ evidence: malformed }));
    expect(insights.diagnosis.readability.state).toBe("unknown");
    expect(insights.diagnosis.visibility.state).toBe("unknown");
  });

  it("is deterministic, does not mutate its input, and labels fictional demo evidence", () => {
    const data = report({ demo: true, evidence: [fetchEvidence(), searchEvidence()], findings: [finding()] });
    const before = JSON.stringify(data);
    const first = buildAuditInsights(data);
    expect(buildAuditInsights(data)).toEqual(first);
    expect(JSON.stringify(data)).toBe(before);
    expect(first.diagnosis.limitations.join(" ")).toContain("fictional demo");
  });
});
