import type { BrowserPayload, ExtractionSummary, FetchPayload, Finding, GapAnalysis, QueryEntry, RobotsPayload, SearchPayload, SitemapPayload, TechnicalCheck } from "../types";
import { buildGap } from "./compare";
import { extractFromFetch } from "./extract";
import { assignIds, buildDeterministicFindings } from "./findings";
import { runSeoChecks } from "./seo";

export interface AnalysisInput {
  auditId: string;
  targetUrl: string;
  queries: QueryEntry[];
  searches: { evidenceId: string; payload: SearchPayload }[];
  fetch?: { evidenceId: string; payload: FetchPayload };
  browser?: { evidenceId: string; payload: BrowserPayload };
  robots?: { evidenceId: string; payload: RobotsPayload };
  sitemap?: { evidenceId: string; payload: SitemapPayload };
}

export interface DeterministicResult {
  extraction?: ExtractionSummary;
  gaps: GapAnalysis[];
  checks: TechnicalCheck[];
  findings: Finding[];
}

/** Layer 1: everything here is computed from observed data only. No model involved. */
export function analyzeDeterministic(i: AnalysisInput): DeterministicResult {
  const f = i.fetch?.payload;
  const extraction = f && !f.error ? extractFromFetch(f, i.browser?.payload) : undefined;
  const checks = runSeoChecks(i);
  const gaps = i.queries.map((q) => {
    const s = i.searches.find((x) => x.payload.query === q.text);
    return buildGap({ query: q.text, fetch: f ?? null, search: s?.payload ?? null, targetUrl: i.targetUrl, evidence: { search: s?.evidenceId, fetch: i.fetch?.evidenceId } });
  });
  const drafts = buildDeterministicFindings({ ...i, checks, gaps });
  return { extraction, gaps, checks, findings: assignIds(i.auditId, drafts) };
}
