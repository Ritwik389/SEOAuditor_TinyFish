import { createHash } from "node:crypto";
import captures from "./live-captures.json";
import { analyzeDeterministic } from "../analysis";
import { matchTarget } from "../url";
import { SCHEMA_VERSION, STAGES, type EvidenceRecord, type FetchPayload, type ReportData, type SearchPayload } from "../types";

/** Public, dated evidence captures collected through real TinyFish MCP Search and Fetch.
 * These are never fed into the live audit orchestrator or stored in a user's history. */
export const LIVE_EXAMPLES = captures.map((c) => ({ slug: c.slug, url: c.url, query: c.query, capturedAt: c.capturedAt, title: c.fetch.title }));

export function getLiveExample(slug: string): ReportData | null {
  const capture = captures.find((c) => c.slug === slug);
  if (!capture) return null;
  const auditId = `capture-${slug}`;
  const capturedAt = capture.capturedAt;
  const raw = capture.fetch;
  const fetched: FetchPayload = {
    requestedUrl: capture.url, finalUrl: raw.final_url, title: raw.title, description: raw.description,
    language: raw.language, author: raw.author, publishedDate: raw.published_date,
    text: raw.text, textLength: raw.originalTextLength, textTruncated: raw.textTruncated,
    pageMetadata: raw.page_metadata ?? null, links: raw.links, latencyMs: raw.latency_ms,
  };
  const results = capture.search.results.map((r) => ({ position: r.position, url: r.url, title: r.title, snippet: r.snippet ?? "", siteName: r.site_name ?? "" }));
  const hit = results.find((r) => matchTarget(capture.url, r.url, { finalUrl: fetched.finalUrl, canonical: fetched.pageMetadata?.canonical }));
  const searched: SearchPayload = {
    query: capture.query, page: capture.search.page, totalResults: capture.search.total_results, results,
    match: hit ? { position: hit.position, url: hit.url, method: matchTarget(capture.url, hit.url, { finalUrl: fetched.finalUrl, canonical: fetched.pageMetadata?.canonical })!.method } : null,
  };
  const record = <P,>(sourceType: "fetch" | "search", payload: P, endpoint: string, request: Record<string, unknown>): EvidenceRecord<P> => ({
    evidenceId: `ev_${sourceType}_1`, auditId, sourceType, label: `TinyFish ${sourceType} · dated live capture`,
    endpoint, sourceUrl: capture.url, query: capture.query, capturedAt, retrieval: sourceType === "fetch" ? "live-or-cache" : "live",
    request, normalizedPayload: payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    metadata: { collection: "TinyFish MCP", publicCapture: true },
    limitations: ["Captured on the displayed date; opening this report does not make a new provider request.", ...(sourceType === "fetch" && raw.textTruncated ? ["Only the first 2,400 characters are retained. Absence and coverage checks apply to this excerpt, not the full page."] : []), "Browser, Agent, robots.txt and sitemap were not inspected in this capture."],
    schemaVersion: SCHEMA_VERSION,
  });
  const search = record("search", searched, "GET https://api.search.tinyfish.ai", { query: capture.query });
  const fetch = record("fetch", fetched, "POST https://api.fetch.tinyfish.ai", { urls: [capture.url], format: "markdown", ttl: 0, page_metadata: true, links: true });
  const queries = [{ text: capture.query, source: "user" as const }];
  const analysis = analyzeDeterministic({ auditId, targetUrl: capture.url, queries, searches: [{ evidenceId: search.evidenceId, payload: searched }], fetch: { evidenceId: fetch.evidenceId, payload: fetched } });
  // Excerpt absence is a candidate for re-checking, never proof that content is missing.
  const findings = analysis.findings.map((f) => raw.textTruncated && f.evidenceRefs.includes(fetch.evidenceId)
    ? { ...f, confidence: "low" as const, verificationStatus: "potential" as const, explanation: `${f.explanation} This public capture retains a bounded excerpt; confirm against a fresh full audit.`, verificationMethod: `Run a fresh audit of ${capture.url} and check the complete Fetch evidence before applying this fix.` }
    : f);
  return {
    audit: {
      auditId, ownerId: "public-capture", schemaVersion: SCHEMA_VERSION, label: raw.title ?? capture.url,
      targetUrl: capture.url, normalizedTargetUrl: capture.url, queries, settings: { verification: "off" },
      status: "completed", cancelRequested: false, createdAt: capturedAt, updatedAt: capturedAt, startedAt: capturedAt, completedAt: capturedAt,
      stages: STAGES.map((s) => ({ stageId: s.id, label: s.label, provider: s.provider, status: ["search", "fetch"].includes(s.id) ? "completed" as const : "skipped" as const, attempt: ["search", "fetch"].includes(s.id) ? 1 : 0, evidenceIds: s.id === "search" ? [search.evidenceId] : s.id === "fetch" ? [fetch.evidenceId] : [], message: ["search", "fetch"].includes(s.id) ? "Real TinyFish MCP request on the capture date." : "Not part of this public capture." })),
      log: [{ t: capturedAt, stageId: "audit", level: "info", message: "Real Search and Fetch collected through TinyFish MCP. Deterministic checks computed from the bounded evidence; additional providers were not called." }],
      summary: { search: hit ? "found" : "not_found", searchPosition: hit?.position, fetch: "ok", browser: "skipped", findingsCount: findings.length, topIssue: findings[0]?.title, firstAction: findings[0]?.recommendedAction, apiCalls: { search: 1, fetch: 1, browser: 0, gemini: 0 }, semanticAnalysis: "unavailable", extraction: analysis.extraction, gaps: analysis.gaps, checks: analysis.checks },
    },
    evidence: [search, fetch], findings,
  };
}
