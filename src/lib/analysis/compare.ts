import type { FetchPayload, GapAnalysis, SearchPayload } from "../types";
import { hostOf } from "../url";
import { parseHeadings } from "./extract";
import { hasTerm, norm, stem, terms } from "./text";

/** Deterministic comparison of what search shows vs what Fetch extracted. */
export function buildGap(p: {
  query: string;
  fetch: FetchPayload | null;
  search: SearchPayload | null;
  targetUrl: string;
  evidence: { search?: string; fetch?: string };
}): GapAnalysis {
  const { query, fetch: f, search: s } = p;
  const notes: string[] = [];
  const qTerms = terms(query).slice(0, 8);
  const h1 = f ? parseHeadings(f.text).find((h) => h.level === 1)?.text ?? "" : "";
  const matched = s?.match ? s.results.find((r) => r.position === s.match!.position) : undefined;
  const pageText = f ? `${f.title ?? ""} ${f.description ?? ""} ${f.text}` : "";

  const coverage = qTerms.map((term) => ({
    term,
    inTitle: !!f?.title && hasTerm(f.title, term),
    inH1: !!h1 && hasTerm(h1, term),
    inDescription: !!f?.description && hasTerm(f.description, term),
    inBody: !!f && hasTerm(f.text, term),
    inSnippet: matched ? hasTerm(`${matched.title} ${matched.snippet}`, term) : null,
  }));

  // Snippet fragments whose content words are mostly absent from the extracted page.
  const snippetPhrasesNotOnPage: string[] = [];
  if (matched && f) {
    const body = norm(pageText);
    for (const frag of matched.snippet.split(/\.{2,}|…|[.!?]\s/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 4)) {
      const ts = terms(frag, 4);
      if (ts.length >= 3 && ts.filter((t) => body.includes(t)).length / ts.length < 0.6) snippetPhrasesNotOnPage.push(frag.slice(0, 200));
    }
  }

  // Terms that 2+ competing results emphasise but the target page never states.
  const competitors = (s?.results ?? []).filter((r) => hostOf(r.url) !== hostOf(p.targetUrl)).slice(0, 6);
  const tally = new Map<string, number>();
  for (const r of competitors) for (const t of new Set(terms(`${r.title} ${r.snippet}`, 5))) tally.set(t, (tally.get(t) ?? 0) + 1);
  const qSet = new Set(qTerms);
  const competitorTerms = f
    ? [...tally.entries()]
        .filter(([t, n]) => n >= 2 && !qSet.has(t) && !norm(pageText).split(" ").some((w) => stem(w) === t))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([term, competitors]) => ({ term, competitors }))
    : [];

  if (!s) notes.push("No search evidence for this query, so search-versus-page comparison is limited to what the page itself says.");
  else if (!matched) notes.push("The target was not found in the checked results, so there is no search snippet to compare with the page.");
  if (!f || f.error) notes.push("Fetch did not return page content, so term coverage could not be measured.");
  else if (qTerms.length && coverage.every((c) => !c.inTitle && !c.inH1)) notes.push("None of the query's key terms appear in the extracted title or H1.");

  return {
    query,
    coverage,
    snippetPhrasesNotOnPage: snippetPhrasesNotOnPage.slice(0, 4),
    competitorTerms,
    notes,
    evidenceRefs: [p.evidence.search, p.evidence.fetch].filter((x): x is string => !!x),
    source: "deterministic",
  };
}
