import { analyzeDeterministic } from "../analysis";
import { assignIds } from "../analysis/findings";
import { mergeSemanticGap, verifyOutput, SemanticSchema } from "../analysis/semantic";
import { matchTarget } from "../url";
import {
  SCHEMA_VERSION, STAGES,
  type AuditDoc, type BrowserPayload, type EvidenceRecord, type FetchPayload, type ReportData, type RobotsPayload, type SearchPayload, type SitemapPayload, type StageRecord,
} from "../types";

// Demo reports are produced by the SAME analysis code as live audits, but from canned, fictional inputs
// (all domains are .example). They are flagged demo=true everywhere and are never mixed into live data.

export interface DemoSpec {
  slug: string;
  kind: string;
  blurb: string;
  label: string;
  target: string;
  query: string;
  results: { title: string; url: string; snippet: string }[];
  fetch: Partial<FetchPayload> & { text: string };
  browser?: Partial<BrowserPayload> & { objective: string };
  robotsBody?: { status: number; genericDisallowsPath?: boolean; aiBotDisallows?: string[] };
  sitemap: { status: number; listsTarget?: boolean; urlCount?: number };
  semantic: unknown;
}

const T0 = Date.parse("2026-09-18T10:00:00Z");

function build(spec: DemoSpec): ReportData {
  const auditId = `demo-${spec.slug}`;
  const at = (s: number) => new Date(T0 + s * 1000).toISOString();
  const ev = (n: number): Pick<EvidenceRecord, "auditId" | "capturedAt" | "contentHash" | "schemaVersion"> => ({ auditId, capturedAt: at(n), contentHash: `demo${n}`.padEnd(16, "0"), schemaVersion: SCHEMA_VERSION });

  const results = spec.results.map((r, i) => ({ position: i + 1, title: r.title, url: r.url, snippet: r.snippet, siteName: new URL(r.url).hostname }));
  const fetched: FetchPayload = {
    requestedUrl: spec.target, finalUrl: spec.target, title: null, description: null, language: "en", author: null, publishedDate: null,
    textLength: spec.fetch.text.length, textTruncated: false, pageMetadata: { canonical: spec.target }, links: [], latencyMs: 640, ...spec.fetch,
  };
  fetched.textLength = fetched.text.length;
  fetched.links ??= [];
  const hit = results.find((r) => matchTarget(spec.target, r.url, { finalUrl: fetched.finalUrl, canonical: fetched.pageMetadata?.canonical }));
  const search: SearchPayload = {
    query: spec.query, page: 0, totalResults: results.length, results,
    match: hit ? { position: hit.position, method: matchTarget(spec.target, hit.url)?.method ?? "normalized", url: hit.url } : null,
  };
  const browser: BrowserPayload | undefined = spec.browser && {
    requestedUrl: spec.target, finalUrl: spec.target, title: fetched.title ?? "", headings: [], visibleTextLength: 3800, visibleTextSample: "", jsonLd: [], canonical: null, robotsMeta: null, linkCount: 40, missingFromFetch: [], ...spec.browser,
  };
  const origin = new URL(spec.target).origin;
  const robots: RobotsPayload = { url: `${origin}/robots.txt`, status: spec.robotsBody?.status ?? 200, bodySample: "", genericDisallowsPath: spec.robotsBody?.genericDisallowsPath ?? false, aiBotDisallows: spec.robotsBody?.aiBotDisallows ?? [], sitemaps: [`${origin}/sitemap.xml`] };
  const sitemap: SitemapPayload = { url: `${origin}/sitemap.xml`, status: spec.sitemap.status, isIndex: false, listsTarget: spec.sitemap.status === 200 ? !!spec.sitemap.listsTarget : null, urlCount: spec.sitemap.urlCount ?? null };

  const evidence: EvidenceRecord[] = [
    { ...ev(8), evidenceId: "ev_search_1", sourceType: "search", label: `Search: ${spec.query}`, endpoint: "GET api.search.tinyfish.ai (demo data)", query: spec.query, retrieval: "live", request: { query: spec.query, location: "US", language: "en" }, normalizedPayload: search, metadata: { demo: true }, limitations: ["DEMO DATA: not a live request.", "One page of results; order is not a guaranteed Google ranking."] },
    { ...ev(9), evidenceId: "ev_fetch_1", sourceType: "fetch", label: "Fetch: target page", endpoint: "POST api.fetch.tinyfish.ai (demo data)", sourceUrl: spec.target, retrieval: "live-or-cache", request: { urls: [spec.target], format: "markdown", links: true, page_metadata: true, ttl: 0 }, normalizedPayload: fetched, metadata: { demo: true }, limitations: ["DEMO DATA: not a live request.", "Fetch returns extracted Markdown, not raw HTML: HTTP status and JSON-LD are not available from this evidence."] },
    ...(browser ? [{ ...ev(24), evidenceId: "ev_browser_1", sourceType: "browser" as const, label: "Browser: rendered page", endpoint: "POST api.browser.tinyfish.ai + CDP (demo data)", sourceUrl: spec.target, retrieval: "live" as const, request: { url: spec.target, objective: browser.objective }, normalizedPayload: browser, metadata: { demo: true }, limitations: ["DEMO DATA: not a live session."] }] : []),
    { ...ev(28), evidenceId: "ev_robots_1", sourceType: "robots", label: "robots.txt", endpoint: "GET {origin}/robots.txt (demo data)", sourceUrl: robots.url, retrieval: "live", request: { url: robots.url }, normalizedPayload: robots, metadata: { demo: true }, limitations: ["DEMO DATA: not a live request."] },
    { ...ev(29), evidenceId: "ev_sitemap_1", sourceType: "sitemap", label: "Sitemap", endpoint: "GET sitemap (demo data)", sourceUrl: sitemap.url, retrieval: "live", request: { url: sitemap.url }, normalizedPayload: sitemap, metadata: { demo: true }, limitations: ["DEMO DATA: not a live request."] },
  ];

  const queries = [{ text: spec.query, source: "user" as const }];
  const det = analyzeDeterministic({
    auditId, targetUrl: spec.target, queries,
    searches: [{ evidenceId: "ev_search_1", payload: search }],
    fetch: { evidenceId: "ev_fetch_1", payload: fetched },
    browser: browser ? { evidenceId: "ev_browser_1", payload: browser } : undefined,
    robots: { evidenceId: "ev_robots_1", payload: robots },
    sitemap: { evidenceId: "ev_sitemap_1", payload: sitemap },
  });

  // The authored "model output" goes through the production verifier, so excerpts must be verbatim to survive.
  const sem = SemanticSchema.parse(spec.semantic);
  const v = verifyOutput(sem, auditId, evidence);
  const findings = assignIds(auditId, [...det.findings, ...v.findings].map(({ findingId, ...rest }) => { void findingId; return rest; }), at(40));
  const gaps = [mergeSemanticGap(det.gaps[0]!, { ...sem.gap, evidenceRefs: v.gapRefs })];
  const extraction = det.extraction && { ...det.extraction, entities: v.entities.map(({ name, type, excerpt }) => ({ name, type, excerpt })) };

  const stages: StageRecord[] = STAGES.map((s, i) => {
    const skipped = (s.id === "browser_verify" && !browser) || s.id === "agent_verify";
    return { stageId: s.id, label: s.label, provider: s.provider, status: skipped ? "skipped" : "completed", attempt: 1, evidenceIds: [], startedAt: at(i * 3), completedAt: at(i * 3 + 2), durationMs: 2000 + i * 150, message: skipped ? "No verification objective in this demo." : "Completed (demo)." };
  });
  const audit: AuditDoc = {
    auditId, ownerId: "demo", schemaVersion: SCHEMA_VERSION, label: `${spec.label} (demo)`, targetUrl: spec.target, normalizedTargetUrl: spec.target, queries,
    settings: { location: "US", language: "en", verification: browser ? "auto" : "off" }, status: "completed", cancelRequested: false,
    createdAt: at(0), updatedAt: at(45), startedAt: at(1), completedAt: at(45), stages,
    log: [{ t: at(0), stageId: "audit", level: "info", message: "Demo report: generated from fictional sample inputs, not from live API calls." }],
    summary: {
      search: search.match ? "found" : "not_found", searchPosition: search.match?.position, fetch: "ok", browser: browser ? "verified" : "skipped",
      findingsCount: findings.length, topIssue: findings[0]?.title, firstAction: findings[0]?.recommendedAction,
      apiCalls: { search: 1, fetch: 1, browser: browser ? 1 : 0, gemini: 1 }, semanticAnalysis: "used", extraction, gaps, checks: det.checks,
    },
  };
  return { audit, evidence, findings, demo: true };
}

const filler = (s: string, n: number) => Array.from({ length: n }, () => s).join(" ");

const SPECS: DemoSpec[] = [
  {
    slug: "saas-pricing",
    kind: "SaaS pricing page",
    blurb: "Found in results, but the page never says what it is in the words people search for.",
    label: "Lumen Metrics pricing",
    target: "https://lumenmetrics.example/pricing",
    query: "product analytics pricing",
    results: [
      { title: "Beacon Analytics Pricing — event-based product analytics", url: "https://beaconanalytics.example/pricing", snippet: "Beacon Analytics pricing: a free plan, then event-based billing for product analytics teams. Compare Starter, Growth and Enterprise." },
      { title: "Flowpoint pricing | Product analytics for SaaS", url: "https://flowpoint.example/pricing", snippet: "Flowpoint product analytics pricing starts free. Event-based billing, unlimited dashboards and a free plan for early-stage teams." },
      { title: "Statmesh Pricing", url: "https://statmesh.example/pricing", snippet: "Statmesh pricing for product analytics: free plan, usage-based billing and SOC 2 reporting." },
      { title: "Compare product analytics tools and pricing", url: "https://toolsradar.example/product-analytics", snippet: "Side-by-side product analytics pricing. Most vendors offer a free plan and bill per event." },
      { title: "Pathlight Analytics pricing", url: "https://pathlight.example/pricing", snippet: "Pathlight pricing: free plan, event-based billing and annual discounts for product analytics." },
      { title: "Plans | Lumen", url: "https://lumenmetrics.example/pricing", snippet: "Plans that scale with you. Start free and upgrade when your team grows. Growth is $49/mo." },
      { title: "Quillboard pricing", url: "https://quillboard.example/pricing", snippet: "Quillboard pricing for teams that want session replay and product analytics." },
    ],
    fetch: {
      title: "Plans | Lumen",
      description: null,
      pageMetadata: { robots: "index, follow" },
      links: ["https://lumenmetrics.example/", "https://lumenmetrics.example/docs", "https://lumenmetrics.example/signup", "https://github.com/lumenmetrics-example"],
      text: `# Plans that scale with you

Lumen helps teams understand how people use their software. Start free and upgrade when your team grows.

## Free

$0/mo. Includes 50,000 events a month and one dashboard. Community support.

## Growth

$49/mo. Growth includes 500,000 events a month, unlimited dashboards and funnels. Email support.

## Scale

$199/mo. Scale includes 5,000,000 events a month, SSO and a dedicated success manager.

## Frequently asked questions

### Can I change plans later?

Yes. You can upgrade or downgrade at any time and billing is prorated.

### What happens if I go over my plan?

We email you first. Nothing is charged without your approval.

${filler("Lumen is built by a distributed team that cares about privacy, simplicity and fast dashboards for product teams.", 8)}
`,
    },
    robotsBody: { status: 200 },
    sitemap: { status: 200, listsTarget: true, urlCount: 64 },
    semantic: {
      gap: {
        searchCommunicates: "A generic 'Plans' page that starts free and quotes Growth at $49/mo, with no mention of analytics.",
        pageExplains: "Three plans priced by monthly events, a prorating policy and a billing safeguard. The word 'analytics' is never used in the title, H1 or plan descriptions.",
        purposeMatch: "partial",
        purposeRationale: "The page is clearly a pricing page for a product that measures usage, but nothing states that it is product analytics software, which is the heart of the query.",
        snippetOmissions: ["Events included per plan", "Unlimited dashboards on Growth", "SSO on Scale"],
        evidenceRefs: ["ev_search_1", "ev_fetch_1"],
      },
      entities: [
        { name: "Growth", type: "plan", excerpt: "Growth includes 500,000 events a month", evidenceId: "ev_fetch_1" },
        { name: "Scale", type: "plan", excerpt: "Scale includes 5,000,000 events a month", evidenceId: "ev_fetch_1" },
      ],
      findings: [
        {
          title: "The page never says it is product analytics software",
          severity: "high", confidence: "medium", category: "relevance",
          explanation: "Evidence suggests the page describes plans in terms of events and dashboards but never uses the phrase product analytics. The opening line says Lumen helps teams understand how people use their software.",
          whyItMatters: "Searchers and retrieval tools match pages to queries by the words the page uses. A pricing page that does not name its category is harder to connect to a category query.",
          evidenceRefs: ["ev_fetch_1", "ev_search_1"],
          excerpts: [{ evidenceId: "ev_fetch_1", text: "Lumen helps teams understand how people use their software" }],
          recommendedAction: "Name the category in the title, H1 and the first sentence, then keep the plan details below it.",
          suggestedImplementation: "<title>Lumen Metrics pricing — product analytics plans</title>\n<h1>Product analytics pricing that scales with your team</h1>\n<p>Lumen is product analytics software for SaaS teams. Start free; upgrade when your event volume grows.</p>",
          expectedOutcome: "The category is explicit to both people and extraction tools. Search results may or may not change.",
          verificationMethod: "Re-run this audit and check that the query terms appear in the title and H1 rows of the coverage table.",
          verificationStatus: "observed",
        },
        {
          title: "Plans are priced per event, but 'event' is never defined",
          severity: "medium", confidence: "medium", category: "content-gaps",
          explanation: "Every plan is limited by events a month, and the FAQ discusses going over the plan, yet the page does not say what counts as an event.",
          whyItMatters: "Competing results explain event-based billing in their snippets. A buyer comparing prices cannot compare quotas without the definition.",
          evidenceRefs: ["ev_fetch_1", "ev_search_1"],
          excerpts: [{ evidenceId: "ev_fetch_1", text: "What happens if I go over my plan?" }],
          recommendedAction: "Add a one-sentence definition of an event and an example of typical monthly usage under the plan table.",
          suggestedImplementation: "An event is any action you send to Lumen, such as a page view, a click or a purchase. A team of 20 typically sends 300,000 events a month.",
          expectedOutcome: "Fewer unanswered questions on the page and a clearer excerpt for tools that summarise pricing.",
          verificationMethod: "Check that the definition appears in the Fetch extraction.",
          verificationStatus: "observed",
        },
      ],
    },
  },
  {
    slug: "ecommerce-product",
    kind: "E-commerce product page",
    blurb: "The page renders fine for people, but Fetch sees almost nothing. Browser verification explains why.",
    label: "Trailhead Ridge GTX boot",
    target: "https://trailheadgear.example/products/ridge-gtx-boot",
    query: "waterproof hiking boots women",
    results: [
      { title: "Women's waterproof hiking boots | Summit & Co", url: "https://summitco.example/womens-waterproof-hiking-boots", snippet: "Shop women's waterproof hiking boots with Gore-Tex lining, Vibram soles and free returns." },
      { title: "Best women's waterproof hiking boots of 2026", url: "https://gearjournal.example/best-womens-hiking-boots", snippet: "We tested 24 pairs of waterproof hiking boots for women across wet trails. Our top picks for fit, grip and weight." },
      { title: "Women's Cascade waterproof hiking boot", url: "https://alpinemade.example/products/cascade-womens", snippet: "The Cascade women's waterproof hiking boot: leather upper, gusseted tongue, sizes 5 to 12. $189." },
      { title: "Waterproof hiking boots for women — REI-style guide", url: "https://trailguide.example/waterproof-boots-women", snippet: "How to choose waterproof hiking boots for women: fit, membranes, and break-in advice." },
      { title: "Women's hiking boots | Waterproof | Pinecrest", url: "https://pinecrest.example/collections/womens-hiking-boots", snippet: "Waterproof women's hiking boots from $120. Free shipping over $75." },
      { title: "Hikewell women's waterproof boots", url: "https://hikewell.example/womens/boots", snippet: "Hikewell women's waterproof hiking boots with wide-fit options and lifetime repair." },
    ],
    fetch: {
      title: "Ridge GTX Boot — Trailhead Gear",
      description: null,
      pageMetadata: { canonical: "https://trailheadgear.example/products/ridge-gtx-boot", robots: "index, follow" },
      links: ["https://trailheadgear.example/", "https://trailheadgear.example/collections/boots"],
      text: `# Ridge GTX Boot

Waterproof leather hiking boot with a Gore-Tex lining.

Unisex sizing. Add to cart.
`,
    },
    browser: {
      objective: "Fetch extracted only 20 words: check whether more content appears after rendering.",
      title: "Ridge GTX Boot — Trailhead Gear",
      headings: [
        { level: 1, text: "Ridge GTX Boot" }, { level: 2, text: "Customer reviews (248)" }, { level: 2, text: "Size & fit" }, { level: 2, text: "Shipping and returns" },
      ],
      visibleTextLength: 5200,
      visibleTextSample: "Ridge GTX Boot $179 Waterproof leather hiking boot with a Gore-Tex lining. Customer reviews (248) 4.7 out of 5. Size & fit: women's sizes 5 to 12 and men's sizes 7 to 14. Shipping and returns: free returns within 60 days.",
      jsonLd: [{ valid: true, types: ["Product", "AggregateRating"], sample: '{"@type":"Product","name":"Ridge GTX Boot"}' }],
      missingFromFetch: ["Customer reviews (248)", "Size & fit", "Shipping and returns"],
    },
    robotsBody: { status: 200, aiBotDisallows: ["GPTBot"] },
    sitemap: { status: 404 },
    semantic: {
      gap: {
        searchCommunicates: "Not applicable: the page was not in the checked results, so no snippet exists to read.",
        pageExplains: "Fetch sees only a title, one sentence and an add-to-cart line. Price, sizes, reviews and returns appear only after rendering.",
        purposeMatch: "unclear",
        purposeRationale: "Fetch alone says 'Unisex sizing', which conflicts with a women's query. The rendered page lists women's sizes 5 to 12, but that is invisible to an extraction pipeline.",
        snippetOmissions: [],
        evidenceRefs: ["ev_fetch_1", "ev_browser_1"],
      },
      entities: [{ name: "Ridge GTX Boot", type: "product", excerpt: "Waterproof leather hiking boot with a Gore-Tex lining", evidenceId: "ev_fetch_1" }],
      findings: [
        {
          title: "The extracted page says 'Unisex sizing' while the rendered page lists women's sizes",
          severity: "high", confidence: "high", category: "messaging",
          explanation: "Fetch extracted the line 'Unisex sizing', but the browser-rendered page says it offers women's sizes 5 to 12. A retrieval tool relying on extraction would not associate this product with women's boots.",
          whyItMatters: "The target query is for women's boots. The only audience statement an extractor can read points the other way.",
          evidenceRefs: ["ev_fetch_1", "ev_browser_1"],
          excerpts: [{ evidenceId: "ev_fetch_1", text: "Unisex sizing" }, { evidenceId: "ev_browser_1", text: "women's sizes 5 to 12 and men's sizes 7 to 14" }],
          recommendedAction: "State the women's and men's size ranges in server-rendered copy near the product title.",
          suggestedImplementation: "<p>Available in women's sizes 5–12 and men's sizes 7–14. Waterproof Gore-Tex lining.</p>",
          expectedOutcome: "The audience and size range become extractable. This does not guarantee any ranking.",
          verificationMethod: "Re-run the audit and confirm the sentence appears in the Fetch text.",
          verificationStatus: "observed",
        },
      ],
    },
  },
  {
    slug: "b2b-service",
    kind: "B2B service landing page",
    blurb: "Good copy, but a leftover noindex, a staging canonical and invalid JSON-LD undermine it.",
    label: "Kestrel SOC 2 readiness",
    target: "https://kestrelcompliance.example/soc-2-readiness",
    query: "soc 2 readiness consultant",
    results: [
      { title: "SOC 2 readiness consulting | Auditline", url: "https://auditline.example/soc-2-readiness", snippet: "SOC 2 readiness consultants for startups. Gap assessment, policies and evidence collection in 8 weeks." },
      { title: "SOC 2 readiness assessment services — Vantage Assure", url: "https://vantageassure.example/soc-2", snippet: "Our SOC 2 readiness assessment finds control gaps before your auditor does. Fixed-fee consultants." },
      { title: "SOC 2 Readiness | Kestrel Compliance", url: "https://kestrelcompliance.example/soc-2-readiness", snippet: "Kestrel guides growing companies through SOC 2. Our team has 15 years of experience in security and compliance." },
      { title: "How to choose a SOC 2 consultant", url: "https://secburo.example/blog/choose-soc-2-consultant", snippet: "Questions to ask a SOC 2 readiness consultant: audit firm relationships, fixed fees, timelines." },
      { title: "SOC 2 readiness consultants for SaaS", url: "https://trustbridge.example/soc-2", snippet: "TrustBridge SOC 2 readiness consultants: gap assessment, policy templates and auditor introductions." },
    ],
    fetch: {
      title: "SOC 2 Readiness | Kestrel Compliance",
      description: "Kestrel guides growing companies through SOC 2 with practical, plain-English advice from experienced security professionals.",
      pageMetadata: { canonical: "https://staging.kestrelcompliance.example/soc-2-readiness", robots: "noindex, follow", og: { title: "Kestrel" } },
      links: ["https://kestrelcompliance.example/", "https://kestrelcompliance.example/contact", "https://kestrelcompliance.example/about", "https://www.linkedin.com/company/kestrel-example"],
      text: `# Compliance, simplified

Kestrel Compliance was founded in 2011 by two security engineers who were tired of audit season. Today our team has 15 years of combined experience helping growing companies earn trust.

## Why Kestrel

We believe compliance should be practical. We work with your team, not around it, and we explain every control in plain English.

## How we work

We start with a conversation, then agree a plan that fits your calendar and your budget.

## Frequently asked questions

### Do you offer a SOC 2 readiness assessment?

Yes. Our SOC 2 readiness assessment compares your controls with the Trust Services Criteria and ranks the gaps by effort.

### How long does SOC 2 take?

Most clients are audit-ready in 8 to 12 weeks. Contact hello@kestrelcompliance.example to book a call.

${filler("Kestrel works with startups and mid-sized SaaS companies across North America and Europe.", 6)}
`,
    },
    browser: {
      objective: "Verification requested: compare the rendered page with the Fetch extraction.",
      title: "SOC 2 Readiness | Kestrel Compliance",
      headings: [{ level: 1, text: "Compliance, simplified" }, { level: 2, text: "Why Kestrel" }, { level: 2, text: "How we work" }],
      visibleTextLength: 2900,
      visibleTextSample: "Compliance, simplified. Kestrel Compliance was founded in 2011 by two security engineers.",
      robotsMeta: "noindex, follow",
      jsonLd: [{ valid: false, types: [], sample: '{"@context":"https://schema.org","@type":"Service","name":"SOC 2 readiness",' }],
      missingFromFetch: [],
    },
    robotsBody: { status: 200, aiBotDisallows: ["GPTBot", "ClaudeBot"] },
    sitemap: { status: 200, listsTarget: false, urlCount: 31 },
    semantic: {
      gap: {
        searchCommunicates: "A generic overview: Kestrel guides growing companies through SOC 2, with 15 years of experience.",
        pageExplains: "A company-history opening, then a FAQ that finally mentions the SOC 2 readiness assessment and an 8 to 12 week timeline.",
        purposeMatch: "partial",
        purposeRationale: "The page offers what the query asks for, but the H1 and opening copy describe the company, not the service. The assessment and timeline appear only in the FAQ.",
        snippetOmissions: ["Readiness assessment compares controls with the Trust Services Criteria", "Audit-ready in 8 to 12 weeks"],
        evidenceRefs: ["ev_search_1", "ev_fetch_1"],
      },
      entities: [{ name: "SOC 2 readiness assessment", type: "service", excerpt: "Our SOC 2 readiness assessment compares your controls with the Trust Services Criteria", evidenceId: "ev_fetch_1" }],
      findings: [
        {
          title: "The service is described in the FAQ, not in the headline or opening copy",
          severity: "medium", confidence: "medium", category: "messaging",
          explanation: "The H1 reads 'Compliance, simplified' and the first paragraph is company history. The words readiness assessment and the 8 to 12 week timeline appear only under the FAQ.",
          whyItMatters: "The search snippet for this page was assembled from the generic opening. Competing results lead with the concrete offer and its timeline.",
          evidenceRefs: ["ev_fetch_1", "ev_search_1"],
          excerpts: [{ evidenceId: "ev_fetch_1", text: "Most clients are audit-ready in 8 to 12 weeks" }],
          recommendedAction: "Lead with what you deliver, for whom, and how long it takes; move the company history lower.",
          suggestedImplementation: "<h1>SOC 2 readiness consulting for growing SaaS companies</h1>\n<p>A fixed-scope readiness assessment, a prioritised gap list and an 8–12 week path to audit-ready.</p>",
          expectedOutcome: "The offer is stated where extractors and snippet generators look first. Rankings are not guaranteed.",
          verificationMethod: "Re-run the audit and compare the extracted H1 and first paragraph with the search snippet.",
          verificationStatus: "observed",
        },
      ],
    },
  },
];

export const DEMO_SLUGS = SPECS.map((s) => ({ slug: s.slug, kind: s.kind, blurb: s.blurb, label: s.label, target: s.target, query: s.query }));

const cache = new Map<string, ReportData>();
export function getDemoReport(slug: string): ReportData | null {
  const spec = SPECS.find((s) => s.slug === slug);
  if (!spec) return null;
  if (!cache.has(slug)) cache.set(slug, build(spec));
  return cache.get(slug)!;
}
