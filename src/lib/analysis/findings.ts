import { SCHEMA_VERSION, type AgentPayload, type Confidence, type Finding, type Severity, type TechnicalCheck, type GapAnalysis, type SearchPayload, type FetchPayload, type BrowserPayload, type RobotsPayload, type VerificationStatus } from "../types";
import { clip, containsExcerpt } from "./text";

export interface DetInput {
  auditId: string;
  targetUrl: string;
  searches: { evidenceId: string; payload: SearchPayload }[];
  fetch?: { evidenceId: string; payload: FetchPayload };
  browser?: { evidenceId: string; payload: BrowserPayload };
  agent?: { evidenceId: string; payload: AgentPayload };
  robots?: { evidenceId: string; payload: RobotsPayload };
  checks: TechnicalCheck[];
  gaps: GapAnalysis[];
}

type Draft = Omit<Finding, "findingId" | "auditId" | "createdAt" | "schemaVersion" | "origin" | "excerpts"> & { excerpts?: { evidenceId: string; text: string }[] };

const SEV: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const CONF: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

/** Severity first, then evidence confidence. Stable for equal pairs. */
export function prioritize<T extends { severity: Severity; confidence: Confidence }>(list: T[]): T[] {
  return list.map((f, i) => ({ f, i })).sort((a, b) => SEV[a.f.severity] - SEV[b.f.severity] || CONF[a.f.confidence] - CONF[b.f.confidence] || a.i - b.i).map((x) => x.f);
}

export function assignIds(auditId: string, drafts: (Draft & { origin?: Finding["origin"] })[], createdAt = new Date().toISOString()): Finding[] {
  return prioritize(drafts).map((d, i) => ({
    ...d,
    origin: d.origin ?? "deterministic",
    excerpts: (d.excerpts ?? []).map((e) => ({ ...e, verified: true })),
    findingId: `F-${String(i + 1).padStart(3, "0")}`,
    auditId,
    createdAt,
    schemaVersion: SCHEMA_VERSION,
  }));
}

const check = (cs: TechnicalCheck[], id: string) => cs.find((c) => c.checkId === id);

const FETCH_FAIL: Record<string, { sev: Severity; conf: Confidence; status: VerificationStatus; fix: string }> = {
  bot_blocked: { sev: "critical", conf: "high", status: "confirmed", fix: "Allow automated retrieval for legitimate fetchers (review bot-protection rules and challenge pages) or serve a plain-HTML version of key content." },
  login_required: { sev: "critical", conf: "high", status: "confirmed", fix: "Make the page reachable without authentication, or publish a public version of the content you want discovered." },
  page_not_found: { sev: "critical", conf: "high", status: "confirmed", fix: "Restore the page or 301-redirect the URL to its current location, then re-run the audit." },
  target_unreachable: { sev: "critical", conf: "medium", status: "observed", fix: "Check DNS, TLS certificate validity and server availability for the URL." },
  target_http_error: { sev: "high", conf: "high", status: "confirmed", fix: "Fix the origin response so the page returns HTTP 200 to anonymous requests." },
  empty_content: { sev: "high", conf: "medium", status: "needs_browser", fix: "If the page renders content with JavaScript, add server-rendered HTML for the main content." },
  timeout: { sev: "medium", conf: "low", status: "potential", fix: "Check origin response time. A single timeout may be transient; re-run the audit before acting." },
};

export function buildDeterministicFindings(i: DetInput): Draft[] {
  const out: Draft[] = [];
  const f = i.fetch?.payload;
  const fe = i.fetch ? [i.fetch.evidenceId] : [];
  const b = i.browser?.payload;
  const be = i.browser ? [i.browser.evidenceId] : [];
  const browserOk = !!b && b.visibleTextLength > 200;

  // ---- Access -----------------------------------------------------------------
  if (f?.error) {
    const meta = FETCH_FAIL[f.error.code] ?? { sev: "medium" as Severity, conf: "low" as Confidence, status: "potential" as VerificationStatus, fix: "Retry the audit and inspect the origin response." };
    const rendered = f.error.code === "empty_content" && browserOk;
    out.push({
      title: rendered ? "Fetch extracted no content, but the page renders in a browser" : `Fetch could not retrieve the page (${f.error.code})`,
      severity: rendered ? "high" : meta.sev,
      confidence: rendered ? "high" : meta.conf,
      category: "access",
      reportSection: "fetch",
      explanation: rendered
        ? `TinyFish Fetch reported empty_content, while the TinyFish Browser rendered ${b!.visibleTextLength} characters of visible text. The content exists for a browser but was not extractable by Fetch.`
        : `${f.error.message}${f.error.status ? ` (HTTP ${f.error.status})` : ""} This is a result from one Fetch request, not proof that every AI tool is blocked.`,
      whyItMatters: "If a retrieval pipeline cannot read the page, it cannot quote, summarise or cite it.",
      evidenceRefs: [...fe, ...(rendered ? be : [])],
      excerpts: [{ evidenceId: i.fetch!.evidenceId, text: `error: ${f.error.code}` }],
      recommendedAction: rendered ? "Serve the main content in the initial HTML response (server-side rendering or static generation)." : meta.fix,
      expectedOutcome: "Fetch should be able to extract the page text on a re-run. This does not guarantee ranking or citation.",
      verificationMethod: "Re-run the audit and confirm the Fetch stage completes with extracted text.",
      verificationStatus: rendered ? "confirmed" : meta.status,
    });
  }

  // ---- robots.txt / robots meta ---------------------------------------------------
  const r = i.robots?.payload;
  if (r?.genericDisallowsPath) {
    out.push({
      title: "robots.txt disallows this URL for all crawlers",
      severity: "critical", confidence: "high", category: "access", reportSection: "technical",
      explanation: `robots.txt contains "${r.matchedRule}", which matches this URL under the rules for the wildcard user agent.`,
      whyItMatters: "Well-behaved crawlers will not fetch the page, so search engines and AI retrieval tools that honour robots.txt may not see it.",
      evidenceRefs: [i.robots!.evidenceId],
      excerpts: [{ evidenceId: i.robots!.evidenceId, text: r.matchedRule ?? "" }],
      recommendedAction: "Remove or narrow the matching Disallow rule if you want this page discovered.",
      suggestedImplementation: `# robots.txt\nUser-agent: *\nAllow: ${new URL(i.targetUrl).pathname}`,
      expectedOutcome: "Crawlers that obey robots.txt become permitted to fetch the page. Indexing is not guaranteed.",
      verificationMethod: "Re-fetch /robots.txt and re-run the audit.",
      verificationStatus: "confirmed",
    });
  } else if (r?.aiBotDisallows.length) {
    out.push({
      title: `robots.txt contains Disallow rules for AI crawlers (${r.aiBotDisallows.join(", ")})`,
      severity: "medium", confidence: "high", category: "access", reportSection: "technical",
      explanation: "robots.txt has user-agent-specific groups that disallow this path for the crawlers listed. Other crawlers may be unaffected.",
      whyItMatters: "If you want these assistants to be able to retrieve the page, these rules work against that. If it is deliberate, no action is needed.",
      evidenceRefs: [i.robots!.evidenceId],
      excerpts: [],
      recommendedAction: "Confirm the rules are intentional; remove them for the crawlers you want to allow.",
      expectedOutcome: "Named crawlers that honour robots.txt would be permitted to fetch the page.",
      verificationMethod: "Re-fetch /robots.txt.",
      verificationStatus: "observed",
    });
  }

  const rm = check(i.checks, "robots_meta");
  if (rm?.status === "fail") {
    out.push({
      title: "Page carries a noindex robots directive",
      severity: "high", confidence: "high", category: "indexing", reportSection: "technical",
      explanation: rm.observed,
      whyItMatters: "A noindex directive asks search engines to leave the page out of their results.",
      evidenceRefs: rm.evidenceRefs, excerpts: rm.evidenceRefs[0] ? [{ evidenceId: rm.evidenceRefs[0], text: rm.observed }] : [],
      recommendedAction: "Remove noindex from the meta tag or X-Robots-Tag header if the page should be discoverable.",
      suggestedImplementation: '<meta name="robots" content="index, follow">',
      expectedOutcome: "The page becomes eligible for indexing once recrawled. Ranking is not guaranteed.",
      verificationMethod: "Fetch the page again and read the robots metadata.",
      verificationStatus: "confirmed",
    });
  }

  // ---- Search ------------------------------------------------------------------------
  for (const s of i.searches) {
    const p = s.payload;
    if (!p.match) {
      const n = p.results.length;
      out.push({
        title: `Not found in checked results for "${clip(p.query, 60)}"`,
        severity: "medium", confidence: n >= 8 ? "medium" : "low", category: "discovery", reportSection: "search",
        explanation: `The target URL did not appear in the ${n} result(s) TinyFish Search returned for this query (page ${p.page}). This is a limited sample from one search source, not proof the page is unindexed.`,
        whyItMatters: "If the page is not surfaced for the query it targets, searchers and retrieval tools using similar results are less likely to reach it.",
        evidenceRefs: [s.evidenceId], excerpts: p.results.slice(0, 3).map((r) => ({ evidenceId: s.evidenceId, text: `#${r.position} ${r.title} — ${r.url}` })),
        recommendedAction: "Compare the page's title, H1 and opening copy with the pages that do appear, and state the query's core terms explicitly.",
        expectedOutcome: "Clearer query alignment can improve relevance signals; results depend on many factors outside this audit.",
        verificationMethod: "Re-run the same query later and with variations; check Search Console for real indexing data.",
        verificationStatus: "observed",
      });
    } else if (p.match.method === "same-path-different-query") {
      out.push({
        title: "Only a URL variant of the target appears in results",
        severity: "low", confidence: "medium", category: "discovery", reportSection: "search",
        explanation: `Result #${p.match.position} shares the host and path but has different query parameters (${p.match.url}).`,
        whyItMatters: "Search may be consolidating or choosing a parameterised variant instead of your preferred URL.",
        evidenceRefs: [s.evidenceId], excerpts: [{ evidenceId: s.evidenceId, text: p.match.url }],
        recommendedAction: "Set a canonical URL on all variants pointing to the preferred address.",
        suggestedImplementation: `<link rel="canonical" href="${i.targetUrl}">`,
        expectedOutcome: "Signals consolidate on the preferred URL over time.",
        verificationMethod: "Re-run the search after the canonical tag is deployed.",
        verificationStatus: "observed",
      });
    }
  }

  // ---- Query alignment ------------------------------------------------------------------
  const g0 = i.gaps[0];
  if (g0 && f && !f.error && g0.coverage.length) {
    const inHead = g0.coverage.filter((c) => c.inTitle || c.inH1).length;
    const inBody = g0.coverage.filter((c) => c.inBody).length;
    const missing = g0.coverage.filter((c) => !c.inBody).map((c) => c.term);
    const ev = [...g0.evidenceRefs];
    if (inBody / g0.coverage.length < 0.5) {
      out.push({
        title: "Key query terms are largely absent from the extracted page",
        severity: "high", confidence: "medium", category: "relevance", reportSection: "gap",
        explanation: `Only ${inBody} of ${g0.coverage.length} key terms from "${g0.query}" appear in the extracted text. Missing: ${missing.join(", ")}.`,
        whyItMatters: "Retrieval and ranking systems rely on the page stating what it is about in the words people use.",
        evidenceRefs: ev, excerpts: fe[0] ? [{ evidenceId: fe[0], text: clip(f.title ?? f.text.slice(0, 120), 140) }] : [],
        recommendedAction: `State ${missing.slice(0, 3).join(", ")} explicitly in the title, H1 and the first paragraph, in natural language.`,
        suggestedImplementation: `<title>${clip(g0.query, 40)} — ${new URL(i.targetUrl).hostname}</title>\n<h1>${clip(g0.query, 60)}</h1>`,
        expectedOutcome: "The page's topic becomes unambiguous to extraction and ranking systems. Results may vary.",
        verificationMethod: "Re-run the audit and check the Query coverage table.",
        verificationStatus: browserOk ? "confirmed" : "observed",
      });
    } else if (inHead === 0) {
      out.push({
        title: "Query terms do not appear in the title or H1",
        severity: "medium", confidence: "medium", category: "relevance", reportSection: "gap",
        explanation: `The query terms appear in the body but not in the title or H1 of the extracted page.`,
        whyItMatters: "Titles and top-level headings are the strongest short summaries of a page.",
        evidenceRefs: ev, excerpts: f.title ? [{ evidenceId: fe[0]!, text: f.title }] : [],
        recommendedAction: "Work the primary query terms into the title and H1 without keyword stuffing.",
        expectedOutcome: "Stronger topical signal for the query.",
        verificationMethod: "Re-run the audit.",
        verificationStatus: "observed",
      });
    }
    if (g0.snippetPhrasesNotOnPage.length) {
      out.push({
        title: "Search snippet text is not found on the extracted page",
        severity: "low", confidence: "low", category: "messaging", reportSection: "gap",
        explanation: `Snippet fragments such as "${g0.snippetPhrasesNotOnPage[0]}" were not found in the Fetch output. The search index may hold older or differently rendered copy, or Fetch may have missed the section.`,
        whyItMatters: "A mismatch can mean stale index data or content that only some retrieval paths can see.",
        evidenceRefs: ev, excerpts: [],
        recommendedAction: "Verify whether that wording still exists on the live page and in the initial HTML.",
        expectedOutcome: "Search and extraction views of the page converge.",
        verificationMethod: "Run with browser verification set to Always.",
        verificationStatus: "needs_browser",
      });
    }
    if (g0.competitorTerms.length >= 2) {
      out.push({
        title: "Competing results emphasise terms this page never states",
        severity: "low", confidence: "low", category: "competitor-comparison", reportSection: "gap",
        explanation: `At least two competing results mention: ${g0.competitorTerms.slice(0, 5).map((t) => `${t.term} (${t.competitors})`).join(", ")}. None appear in the extracted page.`,
        whyItMatters: "These may be expectations searchers associate with the query. They are hypotheses from a small sample, not requirements.",
        evidenceRefs: ev, excerpts: [],
        recommendedAction: "Review whether any of these terms describe your offering truthfully and add them where relevant.",
        expectedOutcome: "Better coverage of the vocabulary used for this query.",
        verificationMethod: "Check against the competing pages in the Search evidence.",
        verificationStatus: "potential",
      });
    }
  }

  // ---- Metadata / structure ---------------------------------------------------------------
  const asFinding = (c: TechnicalCheck | undefined, d: Omit<Draft, "evidenceRefs" | "excerpts" | "explanation" | "verificationStatus" | "reportSection"> & { when: (c: TechnicalCheck) => boolean }) => {
    if (!c || !d.when(c)) return;
    const { when, ...rest } = d;
    void when;
    out.push({ ...rest, explanation: c.observed + (c.note ? ` ${c.note}` : ""), evidenceRefs: c.evidenceRefs, excerpts: c.evidenceRefs[0] ? [{ evidenceId: c.evidenceRefs[0], text: clip(c.observed, 200) }] : [], reportSection: "technical", verificationStatus: c.kind === "inferred" ? "potential" : "observed" });
  };

  asFinding(check(i.checks, "title"), { when: (c) => c.status === "fail", title: "Page title is missing", severity: "high", confidence: "high", category: "metadata", whyItMatters: "The title is the primary label for the page in results and in extraction.", recommendedAction: "Add a unique, descriptive <title> of roughly 30–60 characters.", suggestedImplementation: "<title>Primary topic — Brand</title>", expectedOutcome: "Search and retrieval tools get a clear label for the page.", verificationMethod: "Re-run the audit." });
  asFinding(check(i.checks, "title"), { when: (c) => c.status === "warning", title: "Title length may be suboptimal", severity: "low", confidence: "medium", category: "metadata", whyItMatters: "Overlong titles are truncated; very short ones carry little information.", recommendedAction: "Aim for roughly 30–60 characters that lead with the main topic.", expectedOutcome: "More complete display of the title in results.", verificationMethod: "Re-run the audit." });
  asFinding(check(i.checks, "meta_description"), { when: (c) => c.status === "warning", title: "Meta description missing or outside typical length", severity: "medium", confidence: "medium", category: "metadata", whyItMatters: "Descriptions often seed the search snippet and give extractors a concise summary.", recommendedAction: "Write a 120–160 character description that states what the page offers and for whom.", suggestedImplementation: '<meta name="description" content="What this page offers, for whom, and the key differentiator.">', expectedOutcome: "A controllable summary is available to snippet generators; they may still choose other text.", verificationMethod: "Re-run the audit." });
  asFinding(check(i.checks, "h1"), { when: (c) => c.status === "warning" && /No H1/.test(c.observed), title: "No H1 observed in the extracted content", severity: "medium", confidence: "medium", category: "structure", whyItMatters: "A single clear H1 tells extractors what the page is about.", recommendedAction: "Add one H1 describing the page topic, present in the initial HTML.", suggestedImplementation: "<h1>Primary topic of the page</h1>", expectedOutcome: "Clearer page structure in extraction.", verificationMethod: "Re-run with browser verification to confirm the heading renders." });
  asFinding(check(i.checks, "h1"), { when: (c) => c.status === "warning" && /H1 headings observed/.test(c.observed), title: "Multiple H1 headings observed", severity: "low", confidence: "medium", category: "structure", whyItMatters: "Several H1s dilute the page's primary topic.", recommendedAction: "Keep one H1 and demote the others to H2.", expectedOutcome: "Cleaner heading hierarchy.", verificationMethod: "Re-run the audit." });
  asFinding(check(i.checks, "canonical"), { when: (c) => c.status === "warning" && /differs/.test(c.observed), title: "Canonical URL points to a different address", severity: "medium", confidence: "medium", category: "indexing", whyItMatters: "Search engines may consolidate this page into the canonical target.", recommendedAction: "Confirm the canonical is intentional; otherwise point it at this URL.", expectedOutcome: "Consistent consolidation signals.", verificationMethod: "Re-run the audit." });
  asFinding(check(i.checks, "canonical"), { when: (c) => c.status === "warning" && /No canonical/.test(c.observed), title: "No canonical URL observed", severity: "low", confidence: "medium", category: "indexing", whyItMatters: "Without a canonical, URL variants can compete with each other.", recommendedAction: "Add a self-referencing canonical link.", suggestedImplementation: `<link rel="canonical" href="${i.targetUrl}">`, expectedOutcome: "Duplicate URL variants consolidate.", verificationMethod: "Re-run the audit." });
  asFinding(check(i.checks, "content_volume"), { when: (c) => c.status === "warning", title: "Very little text was extracted from the page", severity: "medium", confidence: browserOk ? "high" : "medium", category: "extraction", whyItMatters: "Thin extracted text gives retrieval tools little to summarise or cite.", recommendedAction: "Add substantive, server-rendered copy covering what the page offers, pricing/specs and FAQs where relevant.", expectedOutcome: "More material available for extraction and quoting.", verificationMethod: "Re-run the audit." });
  asFinding(check(i.checks, "structured_data"), { when: (c) => c.status === "fail", title: "Structured data failed to parse", severity: "medium", confidence: "high", category: "structured-data", whyItMatters: "Invalid JSON-LD is ignored by consumers that read it.", recommendedAction: "Fix the JSON syntax and validate with a structured-data testing tool.", expectedOutcome: "Structured data becomes machine-readable.", verificationMethod: "Re-run with browser verification." });
  asFinding(check(i.checks, "structured_data"), { when: (c) => c.status === "warning", title: "No structured data found in the rendered page", severity: "low", confidence: "medium", category: "structured-data", whyItMatters: "JSON-LD gives machines unambiguous facts such as product, price or organization.", recommendedAction: "Add JSON-LD that matches the page type (for example Product, Organization, FAQPage).", suggestedImplementation: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"…","url":"…"}</script>', expectedOutcome: "Explicit machine-readable facts.", verificationMethod: "Re-run with browser verification." });
  asFinding(check(i.checks, "sitemap"), { when: (c) => c.status === "warning" && /not listed/.test(c.observed), title: "URL is not listed in the sitemap", severity: "low", confidence: "medium", category: "discovery", whyItMatters: "Sitemaps help crawlers find pages that are weakly linked.", recommendedAction: "Add the URL to the sitemap.", expectedOutcome: "Crawlers have an explicit path to the page.", verificationMethod: "Re-fetch the sitemap." });
  asFinding(check(i.checks, "internal_links"), { when: (c) => c.status === "warning", title: "No internal links extracted", severity: "low", confidence: "low", category: "structure", whyItMatters: "Internal links help crawlers and users reach related pages.", recommendedAction: "Link to related pages from the body copy.", expectedOutcome: "Better crawl paths.", verificationMethod: "Re-run the audit." });

  // ---- Browser comparison -----------------------------------------------------------------
  if (b && b.missingFromFetch.length >= 2 && f && !f.error) {
    out.push({
      title: "Rendered page headings are missing from Fetch's extraction",
      severity: "high", confidence: "high", category: "extraction", reportSection: "fetch",
      explanation: `The TinyFish Browser rendered ${b.missingFromFetch.length} headings that do not appear in the Fetch text, for example "${b.missingFromFetch[0]}".`,
      whyItMatters: "Content that a browser shows but an extractor does not see is effectively invisible to pipelines that rely on extraction.",
      evidenceRefs: [...fe, ...be], excerpts: [{ evidenceId: i.browser!.evidenceId, text: b.missingFromFetch.slice(0, 3).join(" | ") }],
      recommendedAction: "Ensure these sections exist in the initial HTML (server-render or pre-render) rather than being injected client-side.",
      expectedOutcome: "Fetch should extract these sections on a re-run.",
      verificationMethod: "Re-run the audit; the missing-headings list should be empty.",
      verificationStatus: "confirmed",
    });
  }

  // Agent-reported text is a useful lead, but the Agent's own text sample is
  // model-produced. It must not be promoted to an independent DOM confirmation.
  const a = i.agent?.payload;
  if (a && f && !f.error && !f.textTruncated && f.text.trim()) {
    const fetchCorpus = `${f.title ?? ""}\n${f.description ?? ""}\n${f.text}`;
    const seen = new Set<string>();
    const missingAnswers = a.answers.filter((answer) => {
      const quote = answer.quote.trim();
      if (quote.length < 6 || seen.has(quote) || !a.visibleTextSample.includes(quote) || containsExcerpt(fetchCorpus, quote)) return false;
      seen.add(quote);
      return true;
    }).slice(0, 3);
    for (const answer of missingAnswers) {
      const quote = answer.quote.trim();
      out.push({
        title: `Agent-reported answer missing from Fetch: ${clip(answer.question, 70)}`,
        severity: "medium", confidence: "medium", category: "extraction", reportSection: "fetch",
        explanation: `The interaction Agent reported an answer to "${answer.question}" and included the exact quoted passage in its own visible-text sample, but that passage was not found in the successful, untruncated Fetch output. Agent observations are model-produced, not an independently captured browser DOM; verify the live text before treating this as a confirmed extraction gap.`,
        whyItMatters: "An answer revealed behind a disclosure or tab may be unavailable to retrieval tools that rely on the extracted page text.",
        evidenceRefs: [i.fetch!.evidenceId, i.agent!.evidenceId],
        excerpts: [{ evidenceId: i.agent!.evidenceId, text: quote }],
        recommendedAction: `Confirm the live answer to "${clip(answer.question, 150)}", then keep that substantive answer in server-rendered HTML so extraction does not depend on opening an accordion or tab.`,
        expectedOutcome: "A new Fetch result should include the confirmed answer. Search visibility and AI citation remain separate observations.",
        verificationMethod: "Verify the quoted passage with an independent browser check, then re-run the audit and confirm it appears in Fetch text.",
        verificationStatus: "needs_browser",
      });
    }
  }
  return out;
}
