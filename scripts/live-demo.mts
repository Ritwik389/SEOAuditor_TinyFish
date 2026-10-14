/** Fresh, reproducible multi-page DTU demo. Never runs in npm test.
 * Set TINYFISH_API_KEY in the calling environment. DEMO_AGENT=1 also uses Agent + Run Status. */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { tfSearch } from "../src/lib/tinyfish/search";
import { tfFetch } from "../src/lib/tinyfish/fetch";
import { verifyWithAgent } from "../src/lib/tinyfish/agent";
import { analyzeDeterministic } from "../src/lib/analysis";
import { matchTarget } from "../src/lib/url";
import { SCHEMA_VERSION, type AgentPayload, type EvidenceKind, type EvidenceRecord, type SearchPayload } from "../src/lib/types";

const key = process.env.TINYFISH_API_KEY;
if (!key) { console.error("Set TINYFISH_API_KEY in your environment. No provider was called."); process.exit(2); }
const pages = [
  { slug: "tinyfish-search", url: "https://docs.tinyfish.ai/search-api", query: "TinyFish Search API structured results" },
  { slug: "mdn-js", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript", query: "JavaScript language reference" },
  { slug: "example-domain", url: "https://example.com", query: "example domain" },
];
const directory = resolve("artifacts/live-audits", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(directory, { recursive: true });
let failed = false;
for (const page of pages) {
  try {
    const auditId = `live-${page.slug}-${Date.now()}`;
    const evidence: EvidenceRecord[] = [];
    const record = <P,>(sourceType: EvidenceKind, payload: P, endpoint: string): EvidenceRecord<P> => {
      const r: EvidenceRecord<P> = { evidenceId: `ev_${sourceType}_${evidence.length + 1}`, auditId, sourceType, label: `TinyFish ${sourceType}`, endpoint,
        sourceUrl: page.url, query: page.query, capturedAt: new Date().toISOString(), retrieval: sourceType === "fetch" ? "live-or-cache" : "live", request: { url: page.url, query: page.query }, normalizedPayload: payload,
        contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), metadata: {}, limitations: ["One live retrieval sample; not a universal ranking or guaranteed citation."], schemaVersion: SCHEMA_VERSION };
      evidence.push(r); return r;
    };
    const [s, f] = await Promise.all([tfSearch(key, { query: page.query }), tfFetch(key, { url: page.url, maxChars: 80_000 })]);
    if (f.payload.error) throw new Error(f.payload.error.message);
    const hit = s.results.find((r) => matchTarget(page.url, r.url, { finalUrl: f.payload.finalUrl, canonical: f.payload.pageMetadata?.canonical }));
    const search: SearchPayload = { ...s, match: hit ? { position: hit.position, url: hit.url, method: matchTarget(page.url, hit.url, { finalUrl: f.payload.finalUrl, canonical: f.payload.pageMetadata?.canonical })!.method } : null };
    const se = record("search", search, "GET https://api.search.tinyfish.ai");
    const fe = record("fetch", f.payload, "POST https://api.fetch.tinyfish.ai");
    let agent: { evidenceId: string; payload: AgentPayload } | undefined;
    let agentError: string | undefined;
    if (process.env.DEMO_AGENT === "1") {
      try {
        const a = await verifyWithAgent(key, { url: page.url, query: page.query, fetchText: f.payload.text, fetchComplete: !f.payload.error && !f.payload.textTruncated && !!f.payload.text.trim(),
          onRun: (event) => { record("agent_run", event.payload, event.endpoint); } });
        const ae = record("agent", a.payload, "POST https://agent.tinyfish.ai/v1/automation/run-async");
        agent = { evidenceId: ae.evidenceId, payload: a.payload };
      } catch (e) { agentError = e instanceof Error ? e.message : "Agent check failed"; failed = true; }
    }
    const analysis = analyzeDeterministic({ auditId, targetUrl: page.url, queries: [{ text: page.query, source: "user" }], searches: [{ evidenceId: se.evidenceId, payload: search }], fetch: { evidenceId: fe.evidenceId, payload: f.payload }, agent });
    const filename = resolve(directory, `${page.slug}.json`);
    await writeFile(filename, JSON.stringify({ targetUrl: page.url, query: page.query, capturedAt: new Date().toISOString(), evidence, analysis, agentError }, null, 2));
    console.log(`${page.url}: ${hit ? `position ${hit.position}` : "absent from checked results"}; ${analysis.extraction?.wordCount ?? 0} extracted words; ${analysis.findings.length} findings${agentError ? `; Agent unavailable: ${agentError}` : ""}\n${filename}`);
  } catch (e) { failed = true; console.error(`${page.url}: ${e instanceof Error ? e.message : "Collection failed"}`); }
}
console.log(`Evidence saved to ${directory}. Agent ${process.env.DEMO_AGENT === "1" ? "requested" : "not requested (set DEMO_AGENT=1 for all four endpoints)"}.`);
process.exitCode = failed ? 1 : 0;
