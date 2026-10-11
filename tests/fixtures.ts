import type { BrowserPayload, EvidenceRecord, FetchPayload, SearchPayload } from "@/lib/types";

export const TARGET = "https://acme-metrics.example.com/pricing";

export const goodMarkdown = `# Acme Metrics pricing

Acme Metrics is product analytics software for SaaS teams. Plans start at $29/mo.

## Starter

Starter costs $29/mo and includes 10,000 events and email support.

## Team

Team costs $99/mo with unlimited dashboards. Contact sales@acme-metrics.example.com or call 555-123-4567.

## FAQ

### Is there a free trial?

Yes, 14 days. ${"Lorem ipsum dolor sit amet consectetur. ".repeat(30)}
`;

export function fetchPayload(over: Partial<FetchPayload> = {}): FetchPayload {
  return {
    requestedUrl: TARGET,
    finalUrl: TARGET,
    title: "Acme Metrics pricing — product analytics plans",
    description: "Compare Acme Metrics plans for product analytics: Starter from $29/mo, Team from $99/mo. Start a 14-day free trial today, no card required.",
    language: "en",
    author: null,
    publishedDate: null,
    text: goodMarkdown,
    textLength: goodMarkdown.length,
    textTruncated: false,
    pageMetadata: { canonical: TARGET, robots: "index, follow", og: { title: "Acme", description: "x" } },
    links: ["https://acme-metrics.example.com/", "https://acme-metrics.example.com/docs", "https://twitter.com/acme"],
    latencyMs: 900,
    ...over,
  };
}

export function searchPayload(over: Partial<SearchPayload> = {}): SearchPayload {
  return {
    query: "product analytics pricing",
    page: 0,
    results: [
      { position: 1, title: "Mixpanel pricing", url: "https://mixpanel.com/pricing", snippet: "Mixpanel pricing for product analytics with a free plan and event based billing.", siteName: "mixpanel.com" },
      { position: 2, title: "Acme Metrics pricing", url: TARGET, snippet: "Plans start at $29/mo for product analytics teams.", siteName: "acme-metrics.example.com" },
      { position: 3, title: "Amplitude pricing", url: "https://amplitude.com/pricing", snippet: "Amplitude pricing: free starter plan, event based billing and enterprise plans for product analytics.", siteName: "amplitude.com" },
    ],
    match: { position: 2, method: "exact", url: TARGET },
    ...over,
  };
}

export function browserPayload(over: Partial<BrowserPayload> = {}): BrowserPayload {
  return {
    requestedUrl: TARGET,
    finalUrl: TARGET,
    title: "Acme Metrics pricing",
    headings: [{ level: 1, text: "Acme Metrics pricing" }],
    visibleTextLength: 4000,
    visibleTextSample: "Acme Metrics pricing",
    jsonLd: [],
    canonical: TARGET,
    robotsMeta: null,
    linkCount: 20,
    objective: "test",
    missingFromFetch: [],
    ...over,
  };
}

export function evidenceRecord<P>(over: Partial<EvidenceRecord<P>> & { evidenceId: string; sourceType: EvidenceRecord["sourceType"]; normalizedPayload: P }): EvidenceRecord<P> {
  return {
    auditId: "a1", label: "x", endpoint: "x", capturedAt: new Date().toISOString(), retrieval: "live", request: {}, contentHash: "h", metadata: {}, limitations: [], schemaVersion: 1,
    ...over,
  };
}
