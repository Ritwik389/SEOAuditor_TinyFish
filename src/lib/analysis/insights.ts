import type { EvidenceRecord, FetchPayload, Finding, ReportData, RobotsPayload, SearchPayload, VerificationStatus } from "../types";
import { norm, stem, terms, words } from "./text";

export interface ReadabilityAxis {
  state: "readable" | "partial" | "failed" | "unknown";
  wordCount: number | null;
  characters: number | null;
  evidenceRefs: string[];
}

export interface VisibilityAxis {
  state: "found" | "not_found" | "partial" | "unknown";
  queriesChecked: number;
  queriesFound: number;
  bestPosition: number | null;
  evidenceRefs: string[];
}

export interface AuditDiagnosis {
  state: "readable_visible" | "readable_unseen" | "retrieval_gap" | "mixed" | "unmeasured";
  title: string;
  explanation: string;
  readability: ReadabilityAxis;
  visibility: VisibilityAxis;
  limitations: string[];
}

export interface InsightQueryCoverage {
  query: string;
  terms: string[];
  bodyPercent: number | null;
  titlePercent: number | null;
  snippetPercent: number | null;
  missingBodyTerms: string[];
  missingSnippetTerms: string[];
  resultsChecked: number | null;
  searchPosition: number | null;
  evidenceRefs: string[];
  limitations: string[];
}

export interface ExtractiveAnswerCard {
  quote: string;
  query: string;
  matchedTerms: string[];
  evidenceRefs: string[];
  sourceUrl: string;
}

export interface AnswerReadiness {
  state: "extractable" | "limited" | "unavailable";
  cards: ExtractiveAnswerCard[];
  notes: string[];
}

export interface InsightFix {
  findingId: string;
  title: string;
  action: string;
  impact: "access" | "relevance" | "clarity" | "verification";
  effort: "small" | "moderate" | "investigate";
  priority: 1 | 2 | 3;
  verification: string;
  verificationStatus: VerificationStatus;
  evidenceRefs: string[];
}

export interface BotAccessObservation {
  agent: string;
  status: "disallowed" | "no_block_observed" | "unknown";
  note: string;
  evidenceRefs: string[];
}

export interface AuditInsights {
  diagnosis: AuditDiagnosis;
  queryCoverage: InsightQueryCoverage[];
  answerReadiness: AnswerReadiness;
  fixPlan: InsightFix[];
  botAccess: BotAccessObservation[];
}

const MAX_ANALYSIS_CHARACTERS = 200_000;
const MAX_QUERIES = 8;
const MAX_QUERY_TERMS = 12;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFetch(value: unknown): value is FetchPayload {
  return object(value) && typeof value.text === "string" && typeof value.requestedUrl === "string";
}

function isSearch(value: unknown): value is SearchPayload {
  return object(value) && typeof value.query === "string" && Array.isArray(value.results)
    && value.results.every((r) => object(r) && typeof r.url === "string" && typeof r.title === "string" && typeof r.snippet === "string" && Number.isFinite(r.position))
    && (value.match === null || (object(value.match) && typeof value.match.url === "string" && Number.isFinite(value.match.position)));
}

function latest<P>(evidence: EvidenceRecord[], kind: string, valid: (value: unknown) => value is P): EvidenceRecord<P> | undefined {
  for (let i = evidence.length - 1; i >= 0; i--) {
    const record = evidence[i]!;
    if (record.sourceType === kind && valid(record.normalizedPayload)) return record as EvidenceRecord<P>;
  }
  return undefined;
}

/** Whole normalized words (with the app's simple singularization), never substrings. */
function tokenSet(text: string): Set<string> {
  return new Set(norm(text).split(" ").filter(Boolean).map(stem));
}

function percent(queryTerms: string[], observed: Set<string> | null): number | null {
  if (!queryTerms.length || !observed) return null;
  return Math.round(100 * queryTerms.filter((term) => observed.has(term)).length / queryTerms.length);
}

function quoteCandidates(text: string): string[] {
  const candidates: string[] = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced || /^\s*#/.test(line) || /^[:|\s-]+$/.test(line)) continue;
    for (const match of line.matchAll(/.+?(?:[.!?](?=\s|$)|$)/g)) {
      const original = match[0].trim();
      // Trim at a word boundary while retaining an exact substring of the source.
      const end = original.length > 500 ? original.lastIndexOf(" ", 500) : original.length;
      const quote = original.slice(0, end > 0 ? end : 500).trim();
      if (words(quote) >= 8 && !/^\s*(?:!\[|<|https?:\/\/)/.test(quote)) candidates.push(quote);
    }
  }
  return [...new Set(candidates)];
}

function fixFromFinding(finding: Finding, validEvidence: Set<string>): InsightFix {
  const verificationNeeded = ["potential", "needs_browser", "unverified"].includes(finding.verificationStatus)
    || !finding.evidenceRefs.some((id) => validEvidence.has(id));
  const impact = verificationNeeded ? "verification"
    : ["access", "indexing", "extraction"].includes(finding.category) ? "access"
      : ["relevance", "discovery", "competitor-comparison"].includes(finding.category) ? "relevance" : "clarity";
  const effort = verificationNeeded ? "investigate"
    : ["access", "extraction", "structured-data"].includes(finding.category) ? "moderate" : "small";
  return {
    findingId: finding.findingId,
    title: finding.title,
    action: finding.recommendedAction,
    impact,
    effort,
    priority: verificationNeeded ? 3 : ["critical", "high"].includes(finding.severity) ? 1 : finding.severity === "medium" ? 2 : 3,
    verification: finding.verificationMethod,
    verificationStatus: finding.verificationStatus,
    evidenceRefs: finding.evidenceRefs.filter((id) => validEvidence.has(id)),
  };
}

/**
 * Client-safe, deterministic interpretation of captured evidence. No network,
 * model-generated answers, ranking score, or claims about unobserved crawlers.
 */
export function buildAuditInsights(report: ReportData): AuditInsights {
  const evidence = report.evidence;
  const validEvidence = new Set(evidence.map((record) => record.evidenceId));
  const fetched = latest(evidence, "fetch", isFetch);
  const fetch = fetched?.normalizedPayload;
  const usableFetch = !!fetch && !fetch.error && fetch.text.trim().length > 0;
  const text = usableFetch ? fetch!.text.slice(0, MAX_ANALYSIS_CHARACTERS) : "";
  const processingLimited = !!fetch && fetch.text.length > MAX_ANALYSIS_CHARACTERS;
  const renderGaps = evidence.filter((record) => record.sourceType === "browser"
    && object(record.normalizedPayload) && Array.isArray(record.normalizedPayload.missingFromFetch)
    && record.normalizedPayload.missingFromFetch.length > 0);
  const agentGaps = evidence.filter((record) => record.sourceType === "agent"
    && object(record.normalizedPayload) && Array.isArray(record.normalizedPayload.missingFromFetch)
    && record.normalizedPayload.missingFromFetch.length > 0);
  const partialFetch = !!fetch?.textTruncated || processingLimited || renderGaps.length > 0;
  const bodyTokens = usableFetch ? tokenSet(text) : null;
  const titleTokens = usableFetch && typeof fetch?.title === "string" && fetch.title.trim() ? tokenSet(fetch.title) : null;
  const searchByQuery = new Map<string, EvidenceRecord<SearchPayload>>();
  for (const record of evidence) {
    if (record.sourceType === "search" && isSearch(record.normalizedPayload)) searchByQuery.set(norm(record.normalizedPayload.query), record as EvidenceRecord<SearchPayload>);
  }
  const allQueries = [...new Map([...report.audit.queries.map((query) => query.text), ...[...searchByQuery.values()].map((record) => record.normalizedPayload.query)]
    .filter((query) => query.trim()).map((query) => [norm(query), query])).values()];
  const queryCoverage: InsightQueryCoverage[] = allQueries.slice(0, MAX_QUERIES).map((query) => {
    const queryTerms = terms(query, 2).slice(0, MAX_QUERY_TERMS);
    const searched = searchByQuery.get(norm(query));
    const search = searched?.normalizedPayload;
    const result = search?.match ? search.results.find((row) => row.position === search.match!.position && row.url === search.match!.url) : undefined;
    // Search visibility and snippet text are separate observations. A match can
    // exist without its snippet being available in the normalized results.
    const snippetTokens = result?.snippet.trim() ? tokenSet(result.snippet) : null;
    const limitations: string[] = [];
    if (!usableFetch) limitations.push("No successful Fetch text is available; page coverage is unmeasured.");
    if (partialFetch && usableFetch) limitations.push("Coverage describes the available Fetch excerpt; absence here does not prove absence from the full page.");
    if (!titleTokens && usableFetch) limitations.push("No extracted title is available for title coverage.");
    if (!search) limitations.push("No successful Search evidence was captured for this query.");
    else if (!result) limitations.push(search.match ? "The matched result's snippet was not captured." : "The target was not in the checked results, so its snippet coverage is unmeasured.");
    else if (!snippetTokens) limitations.push("The matched Search result has no snippet text to measure.");
    if (!queryTerms.length) limitations.push("The query has no measurable content terms after common words are removed.");
    return {
      query, terms: queryTerms,
      bodyPercent: percent(queryTerms, bodyTokens), titlePercent: percent(queryTerms, titleTokens), snippetPercent: percent(queryTerms, snippetTokens),
      missingBodyTerms: bodyTokens ? queryTerms.filter((term) => !bodyTokens.has(term)) : [],
      missingSnippetTerms: snippetTokens ? queryTerms.filter((term) => !snippetTokens.has(term)) : [],
      resultsChecked: search?.results.length ?? null,
      searchPosition: search?.match?.position ?? null,
      evidenceRefs: [fetched?.evidenceId, searched?.evidenceId].filter((id): id is string => !!id),
      limitations,
    };
  });

  const searches = [...searchByQuery.values()];
  const matches = searches.filter((record) => record.normalizedPayload.match !== null);
  const readability: ReadabilityAxis = {
    state: !fetch ? "unknown" : !usableFetch ? "failed" : partialFetch ? "partial" : "readable",
    wordCount: fetch && !fetch.error ? words(text) : null,
    characters: fetch && !fetch.error ? text.length : null,
    evidenceRefs: [fetched?.evidenceId, ...renderGaps.map((record) => record.evidenceId)].filter((id): id is string => !!id),
  };
  const visibility: VisibilityAxis = {
    state: !searches.length ? "unknown" : searches.length < allQueries.length || (matches.length > 0 && matches.length < searches.length) ? "partial" : matches.length ? "found" : "not_found",
    queriesChecked: searches.length,
    queriesFound: matches.length,
    bestPosition: matches.length ? Math.min(...matches.map((record) => record.normalizedPayload.match!.position)) : null,
    evidenceRefs: searches.map((record) => record.evidenceId),
  };
  const limitations = ["Search positions describe only the results returned for the checked queries; they are not a universal ranking. Readability does not establish why a page ranks or whether an assistant will cite it."];
  if (report.demo) limitations.push("This is a fictional demo report; these observations do not describe a live page.");
  if (fetch?.error) limitations.push(`Fetch failed (${fetch.error.code}); one retrieval failure does not establish that every AI tool is blocked.`);
  if (fetch?.textTruncated) limitations.push("Fetch text was truncated; missing content may be beyond the captured excerpt.");
  if (processingLimited) limitations.push(`Analysis is bounded to the first ${MAX_ANALYSIS_CHARACTERS.toLocaleString("en-US")} captured characters.`);
  if (renderGaps.length) limitations.push("Browser evidence reports content missing from Fetch; these retrieval views differ.");
  if (agentGaps.length) limitations.push("The interaction Agent reported possible content gaps. Its model-produced text sample is not an independent DOM capture; verify these leads before claiming Fetch missed live content.");
  if (!searches.length) limitations.push("No successful Search evidence is available, so visibility cannot be assessed.");
  if (searches.length > 0 && searches.length < allQueries.length) limitations.push("Some requested queries have no successful Search evidence; visibility is only partly measured.");
  if (allQueries.length > MAX_QUERIES) limitations.push(`The query coverage table shows the first ${MAX_QUERIES} queries.`);

  let state: AuditDiagnosis["state"] = "unmeasured";
  let title = "More evidence is needed";
  let explanation = "Readability and search visibility require both a successful live retrieval and checked search results.";
  if (readability.state !== "unknown" && visibility.state !== "unknown") {
    if (readability.state !== "readable") {
      state = "retrieval_gap";
      title = visibility.queriesFound ? "Search found the page; extraction evidence is limited" : "Retrieval needs attention";
      explanation = visibility.queriesFound
        ? `The target appeared for ${visibility.queriesFound} checked query or queries, but Fetch ${readability.state === "failed" ? "did not yield usable text" : "evidence retains an incomplete view"}. Verify the complete extraction before treating search visibility as answer readiness.`
        : "Fetch did not provide a complete readable view, and the target was not observed in the checked results. Restore or verify retrieval first; these observations do not identify the cause of search visibility.";
    } else if (visibility.state === "not_found") {
      state = "readable_unseen"; title = "Readable to Fetch, absent from checked search results";
      explanation = "Fetch extracted page text, but the target was not returned for the checked queries. Review query coverage and discovery findings; successful extraction alone does not guarantee search visibility.";
    } else if (visibility.state === "found") {
      state = "readable_visible"; title = "Readable and present in checked search results";
      explanation = "Search surfaced the target and Fetch extracted its text. Review the exact passages below to see what a retrieval tool can quote; appearing in results does not guarantee citation.";
    } else {
      state = "mixed"; title = "Readable, with visibility varying by query";
      explanation = `Fetch extracted page text. The target appeared in ${visibility.queriesFound} of ${visibility.queriesChecked} checked queries; inspect each query's coverage and any missing Search evidence.`;
    }
  }

  const cards: ExtractiveAnswerCard[] = [];
  const candidateQuotes = usableFetch ? quoteCandidates(text) : [];
  const usedQuotes = new Set<string>();
  const ranked = queryCoverage.flatMap((row, queryIndex) => candidateQuotes.map((quote, index) => {
    const quoteTerms = tokenSet(quote);
    const matchedTerms = row.terms.filter((term) => quoteTerms.has(term));
    return { quote, matchedTerms, query: row.query, index, queryIndex };
  })).filter((candidate) => candidate.matchedTerms.length > 0)
    .sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || a.queryIndex - b.queryIndex || a.index - b.index);
  for (const candidate of ranked) {
    if (usedQuotes.has(candidate.quote)) continue;
    usedQuotes.add(candidate.quote);
    cards.push({ quote: candidate.quote, query: candidate.query, matchedTerms: candidate.matchedTerms, evidenceRefs: [fetched!.evidenceId], sourceUrl: fetch!.finalUrl ?? fetch!.requestedUrl });
    if (cards.length === 4) break;
  }
  const answerNotes = ["These are verbatim Fetch excerpts selected by query-term overlap, not generated answers or a prediction of citation."];
  if (!usableFetch) answerNotes.push("No successful extracted text is available to quote.");
  else if (!cards.length) answerNotes.push(allQueries.length ? "No substantive passage matched the measured query terms; review the full Fetch evidence." : "Add a target query to identify relevant extractive passages.");
  if (partialFetch && usableFetch) answerNotes.push("Answer candidates come from an incomplete Fetch view; additional answer content may be missing.");

  const robots = latest(evidence, "robots", (value): value is RobotsPayload => object(value) && Array.isArray(value.aiBotDisallows) && value.aiBotDisallows.every((agent) => typeof agent === "string"));
  const robotsPayload = robots?.normalizedPayload;
  const robotsUsable = !!robotsPayload && robotsPayload.status === 200 && !robotsPayload.error && typeof robotsPayload.genericDisallowsPath === "boolean";
  const botAccess: BotAccessObservation[] = [{
    agent: "Wildcard crawlers (*)",
    status: !robotsUsable ? "unknown" : robotsPayload!.genericDisallowsPath ? "disallowed" : "no_block_observed",
    note: !robotsUsable ? "No successful, parseable robots.txt observation is available."
      : robotsPayload!.genericDisallowsPath ? `A wildcard rule matches this URL${robotsPayload!.matchedRule ? `: ${robotsPayload!.matchedRule}` : "."}`
        : "No matching wildcard Disallow was reported. Bot-specific rules can differ; this does not prove a successful fetch.",
    evidenceRefs: robots ? [robots.evidenceId] : [],
  }];
  if (robotsUsable) for (const agent of [...new Set(robotsPayload!.aiBotDisallows)].slice(0, 12)) {
    botAccess.push({ agent, status: "disallowed", note: "The observed bot-specific robots.txt group disallows this target path. This is a policy observation, not a bot request test.", evidenceRefs: [robots!.evidenceId] });
  }

  const fixPlan = report.findings.filter((finding) => finding.recommendedAction.trim() && finding.verificationMethod.trim())
    .map((finding) => fixFromFinding(finding, validEvidence))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 6);
  return {
    diagnosis: { state, title, explanation, readability, visibility, limitations },
    queryCoverage,
    answerReadiness: { state: !usableFetch ? "unavailable" : cards.length && !partialFetch ? "extractable" : "limited", cards, notes: answerNotes },
    fixPlan,
    botAccess,
  };
}
