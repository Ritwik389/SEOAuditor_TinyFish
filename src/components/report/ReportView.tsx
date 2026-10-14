"use client";

import { Check, ChevronDown, Minus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { BrowserPayload, EvidenceRecord, FetchPayload, Finding, GapAnalysis, ReportData, SearchPayload, Severity, TechnicalCheck } from "@/lib/types";
import { Logo } from "../brand/Logo";
import { Timeline } from "../Timeline";
import { AuditStatusBadge, Banner, CheckBadge, ConfidenceBadge, DemoBadge, EmptyState, ExtLink, SeverityBadge, cx, fmtDate, sevColor } from "../ui";
import { AuditInsights } from "./AuditInsights";

const SECTIONS = [
  ["summary", "Summary"],
  ["insights", "AI readiness"],
  ["search", "Search"],
  ["fetch", "Extraction"],
  ["gap", "Gap analysis"],
  ["technical", "Technical checks"],
  ["findings", "Findings"],
  ["evidence", "Evidence"],
  ["method", "Methodology"],
] as const;

const VSTATUS: Record<string, string> = {
  confirmed: "Confirmed by evidence",
  observed: "Observed",
  potential: "Potential issue",
  needs_browser: "Requires browser verification",
  unverified: "Insufficient evidence to confirm",
};
const SECTION_LABEL: Record<string, string> = { search: "Search visibility", fetch: "Fetch extraction", gap: "Visibility gap analysis", technical: "Technical checks" };

const EvLink = ({ id }: { id: string }) => (
  <a href={`#ev-${id}`} className="mono-label underline decoration-[#bbb] underline-offset-2 hover:decoration-ink">{id}</a>
);

function Section({ id, title, eyebrow, children }: { id: string; title: string; eyebrow?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 space-y-5 border-t border-hairline pt-8 first:border-0 first:pt-0">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 id={`${id}-h`} className="t-display-lg mt-1">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 break-words text-[15px]">{children}</dd>
    </div>
  );
}

function StackBar({ parts, label }: { parts: { key: string; n: number; color: string; text: string }[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (!total) return null;
  return (
    <figure aria-label={label}>
      <div className="flex h-2.5 overflow-hidden rounded-[2px] bg-hairline" role="img" aria-label={parts.filter((p) => p.n).map((p) => `${p.n} ${p.text}`).join(", ")}>
        {parts.filter((p) => p.n).map((p) => <span key={p.key} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} />)}
      </div>
      <figcaption className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {parts.filter((p) => p.n).map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: p.color }} />{p.n} {p.text}</span>
        ))}
      </figcaption>
    </figure>
  );
}

const trunc = (_k: string, v: unknown) => (typeof v === "string" && v.length > 700 ? v.slice(0, 700) + `… [${v.length - 700} more characters]` : v);
const json = (v: unknown) => JSON.stringify(v, trunc, 2);

function Tick({ v }: { v: boolean | null }) {
  if (v === null) return <span className="text-faint"><Minus size={14} className="inline" aria-hidden /><span className="sr-only">no snippet to compare</span></span>;
  return v ? <span className="text-ok"><Check size={15} className="inline" aria-hidden /><span className="sr-only">present</span></span> : <span className="text-crit"><X size={15} className="inline" aria-hidden /><span className="sr-only">absent</span></span>;
}

export function ReportView({ report, print = false }: { report: ReportData; print?: boolean }) {
  const { audit, evidence, findings } = report;
  const summary = audit.summary;
  const [qi, setQi] = useState(0);

  const searchEv = evidence.filter((e) => e.sourceType === "search") as EvidenceRecord<SearchPayload>[];
  const fetchEv = evidence.find((e) => e.sourceType === "fetch") as EvidenceRecord<FetchPayload> | undefined;
  const browserEv = evidence.find((e) => e.sourceType === "browser") as EvidenceRecord<BrowserPayload> | undefined;
  const query = audit.queries[qi];
  const sEv = searchEv.find((e) => e.normalizedPayload.query === query?.text);
  const gap: GapAnalysis | undefined = summary?.gaps.find((g) => g.query === query?.text);
  const f = fetchEv?.normalizedPayload;
  const b = browserEv?.normalizedPayload;
  const usedBy = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const fd of findings) for (const r of fd.evidenceRefs) m.set(r, [...(m.get(r) ?? []), fd.findingId]);
    for (const c of summary?.checks ?? []) for (const r of c.evidenceRefs) m.set(r, [...(m.get(r) ?? []), c.checkId]);
    return m;
  }, [findings, summary]);

  // Anchors to evidence/findings should open the <details> they point at.
  useEffect(() => {
    const open = () => {
      const el = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
      if (el instanceof HTMLDetailsElement) el.open = true;
      el?.scrollIntoView({ block: "start" });
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  const sevCounts = (["critical", "high", "medium", "low"] as Severity[]).map((s) => ({ key: s, n: findings.filter((x) => x.severity === s).length, color: sevColor(s), text: s }));
  const checks = summary?.checks ?? [];
  const chk = (s: string) => checks.filter((c) => c.status === s).length;
  const searchVerdict = summary?.search;
  const primary = audit.queries[0];

  return (
    <div className={cx(print ? "" : "lg:grid lg:grid-cols-[180px_1fr] lg:gap-10")}>
      {!print ? (
        <nav aria-label="Report sections" className="no-print sticky top-0 z-10 -mx-4 mb-6 overflow-x-auto border-b border-hairline bg-canvas px-4 py-2 lg:top-8 lg:mx-0 lg:mb-0 lg:self-start lg:border-0 lg:p-0">
          <ul className="flex gap-1 lg:flex-col">
            {SECTIONS.map(([id, label]) => (
              <li key={id} className="shrink-0"><a href={`#${id}`} className="flex min-h-10 items-center rounded-sm px-3 text-sm text-muted hover:bg-hairline hover:text-ink">{label}</a></li>
            ))}
          </ul>
        </nav>
      ) : null}

      <article className="min-w-0 space-y-10">
        {print ? <header className="flex items-center justify-between border-b border-ink pb-3"><Logo size={26} /><span className="eyebrow">AI visibility report</span></header> : null}

        {/* ---------- Header ---------- */}
        <header>
          <div className="flex flex-wrap items-center gap-2">
            {report.demo ? <DemoBadge /> : null}
            <AuditStatusBadge s={audit.status} />
          </div>
          <h1 className="t-display-lg mt-2 break-words">{audit.label || "AI search visibility report"}</h1>
          <p className="mt-1 text-muted"><ExtLink href={audit.targetUrl}>{audit.targetUrl}</ExtLink></p>
        </header>

        {report.demo ? <Banner tone="info" title="Demonstration data">This report is a sample built from fictional pages. It was not produced by live TinyFish or Gemini calls. Live audits make real requests and never reuse demo evidence.</Banner> : null}
        {audit.status === "partial" ? <Banner tone="warn" title="Partial report">One or more steps failed or were unavailable. Findings below are limited to the evidence that was actually collected; see the activity log for what failed.</Banner> : null}
        {audit.status === "failed" ? <Banner tone="error" title="This audit failed">{audit.errorSummary ?? "No usable evidence could be collected."}</Banner> : null}
        {audit.status === "cancelled" ? <Banner tone="info" title="Audit cancelled">Evidence collected before cancellation is shown; incomplete stages are marked skipped.</Banner> : null}

        {/* ---------- 1. Executive summary ---------- */}
        <Section id="summary" title="Executive summary" eyebrow="1 · Overview">
          <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Target URL"><ExtLink href={audit.targetUrl}>{audit.targetUrl}</ExtLink></Fact>
            <Fact label="Target query">
              {primary ? <>“{primary.text}” <span className="badge ml-1">{primary.source === "user" ? "user-provided" : "automatically generated"}</span></> : <span className="text-muted">None: fetch-only audit</span>}
            </Fact>
            <Fact label="Audit timestamp">{fmtDate(audit.completedAt ?? audit.createdAt)}</Fact>
            <Fact label="Search discovery">
              {searchVerdict === "found" ? `Found at position ${summary?.searchPosition} in checked results` : searchVerdict === "not_found" ? "Not found in checked results" : searchVerdict === "failed" ? "Search failed" : "Not run"}
            </Fact>
            <Fact label="Fetch extraction">{summary?.fetch === "ok" ? "Content extracted" : summary?.fetch === "failed" ? `Failed${f?.error ? ` (${f.error.code})` : ""}` : "Not run"}</Fact>
            <Fact label="Browser verification">{{ verified: "Verified in a rendered page", skipped: "Skipped (no objective or turned off)", failed: "Attempted, failed", unavailable: "Unavailable for this account" }[summary?.browser ?? "skipped"]}</Fact>
            <Fact label="Actionable findings">{findings.length}</Fact>
            <Fact label="Most important issue">{summary?.topIssue ?? "None identified from the evidence collected"}</Fact>
            <Fact label="Recommended first action">{summary?.firstAction ?? "—"}</Fact>
          </dl>
          <div className="grid gap-6 sm:grid-cols-2">
            <div><p className="eyebrow mb-2">Findings by severity</p>{findings.length ? <StackBar label="Findings by severity" parts={sevCounts} /> : <p className="text-sm text-muted">No findings.</p>}</div>
            <div><p className="eyebrow mb-2">Technical checks</p>
              <StackBar label="Technical checks by status" parts={[
                { key: "pass", n: chk("pass"), color: "#067647", text: "pass" }, { key: "warning", n: chk("warning"), color: "#c99a1a", text: "warning" }, { key: "fail", n: chk("fail"), color: "#b42318", text: "fail" },
                { key: "unknown", n: chk("unknown"), color: "#9a9a9a", text: "unknown" }, { key: "nc", n: chk("not_checked"), color: "#d6d6d6", text: "not checked" },
              ]} />
            </div>
          </div>
          <p className="rounded-sm border border-hairline bg-[#fafafa] p-3 text-sm text-muted">These results describe sampled retrieval evidence from {summary?.apiCalls.search ?? 0} search request(s) and {summary?.apiCalls.fetch ?? 0} fetch request(s) at one point in time. They are not guaranteed universal AI rankings.</p>
        </Section>

        <Section id="insights" title="AI readiness and visibility" eyebrow="Evidence into action">
          <AuditInsights report={report} />
        </Section>

        {/* ---------- 2. Search ---------- */}
        <Section id="search" title="Search visibility analysis" eyebrow="2 · Discovery">
          {audit.queries.length > 1 ? (
            <div role="tablist" aria-label="Queries" className="flex flex-wrap gap-2">
              {audit.queries.map((q, i) => (
                <button key={q.text} role="tab" aria-selected={i === qi} onClick={() => setQi(i)} className={cx("btn btn-sm normal-case tracking-normal", i === qi ? "btn-primary" : "btn-outline")}>“{q.text}”</button>
              ))}
            </div>
          ) : null}
          {!query ? (
            <EmptyState title="No query, no search">This audit was run without a query, so search was skipped. Run a new audit with a query (or use “Propose”) to see how the page appears in results.</EmptyState>
          ) : !sEv ? (
            <EmptyState title="No search evidence for this query">{summary?.search === "failed" || audit.status === "failed" ? "The Search request failed. Check the activity log for the sanitized error." : "Search did not return results for this query."}</EmptyState>
          ) : (
            <SearchBlock ev={sEv} query={query} targetUrl={audit.targetUrl} />
          )}
        </Section>

        {/* ---------- 3. Fetch ---------- */}
        <Section id="fetch" title="Fetch extraction analysis" eyebrow="3 · Extraction">
          {!fetchEv || !f ? (
            <EmptyState title="Fetch did not run">There is no extraction evidence for this audit.</EmptyState>
          ) : (
            <FetchBlock ev={fetchEv} f={f} b={b} browserEv={browserEv} summary={summary} />
          )}
        </Section>

        {/* ---------- 4. Gap ---------- */}
        <Section id="gap" title="Visibility gap analysis" eyebrow="4 · Search vs. page">
          {!gap ? (
            <EmptyState title="Insufficient evidence for a gap analysis">A comparison needs both search results and extracted page content for the query.</EmptyState>
          ) : (
            <GapBlock gap={gap} f={f} sEv={sEv} needsBrowser={!b && (summary?.fetch === "failed" || (summary?.extraction?.wordCount ?? 999) < 150)} />
          )}
        </Section>

        {/* ---------- 5. Technical ---------- */}
        <Section id="technical" title="Technical SEO checks" eyebrow="5 · Deterministic">
          <p className="text-sm text-muted"><strong className="font-medium text-ink">Observed</strong> rows report something a tool returned. <strong className="font-medium text-ink">Inferred</strong> rows are conclusions drawn from absence and may need confirmation. “Not checked” means no evidence was collected, never that it passed.</p>
          <ChecksTable checks={checks} />
        </Section>

        {/* ---------- 6. Findings ---------- */}
        <Section id="findings" title="Findings and recommendations" eyebrow="6 · Prioritized">
          <FindingsBlock findings={findings} print={print} status={audit.status} hasEvidence={evidence.length > 0} />
        </Section>

        {/* ---------- 7. Evidence ---------- */}
        <Section id="evidence" title="Evidence inspector" eyebrow="7 · Sources">
          <p className="text-sm text-muted">Every finding and check cites these records. Records store normalized, sanitized data only: no keys, headers or credentials.</p>
          <div className="space-y-2">
            {evidence.length === 0 ? <p className="text-muted">No evidence was stored for this audit.</p> : null}
            {evidence.map((e) => <EvidenceItem key={e.evidenceId} e={e} usedBy={usedBy.get(e.evidenceId) ?? []} open={print} />)}
          </div>
        </Section>

        {/* ---------- Activity ---------- */}
        <details className="card p-0 print-block" open={print || undefined}>
          <summary className="flex min-h-11 cursor-pointer items-center justify-between px-4 py-3 font-medium">Activity log and stage results<ChevronDown size={16} aria-hidden /></summary>
          <div className="border-t border-hairline p-5"><Timeline stages={audit.stages} log={audit.log} live={false} auditStatus={audit.status} /></div>
        </details>

        {/* ---------- 8. Methodology ---------- */}
        <Section id="method" title="Limitations and methodology" eyebrow="8 · How to read this">
          <ul className="list-inside list-disc space-y-1.5 text-[15px] text-[#333]">
            <li><strong className="font-medium">Search</strong> is one request to TinyFish Search per query (one page of results). Position means order in that response, not a Google, Bing or universal AI ranking. A page missing from the sample is “Not found in checked results”, which does not mean “not indexed”.</li>
            <li><strong className="font-medium">Fetch</strong> returns extracted Markdown plus metadata and links. HTTP status, response headers, JSON-LD and exact markup are not returned, so SEOAuditor never infers them from text. TinyFish may serve a cached copy even when a live fetch is requested.</li>
            <li><strong className="font-medium">Browser</strong> runs only with a concrete verification objective or when you enable it. It is one session from TinyFish’s network and may differ from what other visitors see.</li>
            <li><strong className="font-medium">Agent interaction check</strong> is opt-in and observes read-only page interactions. Reported blockers and content differences are session observations. Agent run status evidence records provider execution separately from the extracted observations.</li>
            <li><strong className="font-medium">robots.txt and sitemap</strong> are read directly by SEOAuditor from the public site. Directives are declared preferences; compliance depends on each crawler.</li>
            <li><strong className="font-medium">Deterministic checks</strong> are computed only from observed data. <strong className="font-medium">AI-interpreted findings</strong> are produced by a language model from the collected evidence, validated against a schema, and any excerpt that is not verbatim in the cited evidence is discarded.</li>
            <li>Broken links are not tested. A successful Fetch does not prove a page is indexable or readable by every AI tool.</li>
            <li>Semantic analysis: <strong className="font-medium">{summary?.semanticAnalysis === "used" ? "used" : summary?.semanticAnalysis === "failed" ? "attempted, failed (deterministic findings only)" : "not used (deterministic findings only)"}</strong>. API calls made: search {summary?.apiCalls.search ?? 0}, fetch {summary?.apiCalls.fetch ?? 0}, browser {summary?.apiCalls.browser ?? 0}, Agent {summary?.apiCalls.agent ?? 0}, Agent run status {summary?.apiCalls.agentStatus ?? 0}, Gemini {summary?.apiCalls.gemini ?? 0}.</li>
          </ul>
        </Section>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------

function SearchBlock({ ev, query, targetUrl }: { ev: EvidenceRecord<SearchPayload>; query: { text: string; source: string; rationale?: string }; targetUrl: string }) {
  const p = ev.normalizedPayload;
  const m = p.match;
  const hit = m ? p.results.find((r) => r.position === m.position) : undefined;
  return (
    <div className="space-y-5">
      <div className={cx("rounded-sm border p-4", m ? "border-[#a6e1c0] bg-ok-bg" : "border-[#f0d58a] bg-med-bg")}>
        <p className="font-medium">{m ? `Found at position ${m.position} of ${p.results.length} checked results` : "Not found in checked results"}</p>
        <p className="mt-1 text-sm text-[#333]">
          Query “{query.text}” ({query.source === "user" ? "user-provided" : "automatically generated"}). Sample: {p.results.length} result(s), page {p.page + 1}
          {p.location ? `, region ${p.location}` : ""}{p.language ? `, language ${p.language}` : ""}. {m ? "" : "This is a limited sample, not proof the page is unindexed."}
        </p>
        {m ? <p className="mt-1 text-sm text-[#333]">Match method: <strong className="font-medium">{m.method}</strong>{m.method === "same-path-different-query" ? " (a URL variant, weaker evidence)" : ""}. Matching URL: <ExtLink href={m.url}>{m.url}</ExtLink></p> : null}
      </div>
      <ol className="card divide-y divide-hairline" aria-label="Observed result sequence">
        {p.results.map((r) => {
          const isTarget = m?.position === r.position;
          return (
            <li key={r.position} className={cx("flex gap-3 p-4", isTarget && "bg-[#fafafa] outline outline-2 -outline-offset-2 outline-ink")}>
              <span className={cx("mono-label grid h-7 w-7 shrink-0 place-items-center rounded-sm", isTarget ? "bg-ink text-white" : "bg-hairline")} aria-label={`Position ${r.position}`}>{r.position}</span>
              <div className="min-w-0">
                <p className="font-medium">{r.title || "(no title)"} {isTarget ? <span className="badge ml-1 border-ink bg-mint">Your page</span> : null}</p>
                <p className="mono-label break-all text-muted">{r.url}</p>
                {r.snippet ? <p className="mt-1 text-sm text-[#333]">{r.snippet}</p> : null}
              </div>
            </li>
          );
        })}
        {p.results.length === 0 ? <li className="p-4 text-muted">Search returned no results for this query.</li> : null}
      </ol>
      {hit ? <p className="text-sm text-muted">Result title: “{hit.title}”. Final-URL comparison uses the Fetch result when available (target: {targetUrl}).</p> : null}
      <p className="text-sm text-muted">Competing pages: {p.results.filter((r) => r.position !== m?.position).slice(0, 5).map((r) => r.siteName || new URL(r.url).hostname).join(", ") || "none observed"}. Evidence: <EvLink id={ev.evidenceId} /></p>
      <details className="text-sm"><summary className="cursor-pointer text-muted">Sample size and limitations</summary><ul className="mt-2 list-inside list-disc text-muted">{ev.limitations.map((l) => <li key={l}>{l}</li>)}</ul></details>
    </div>
  );
}

function FetchBlock({ ev, f, b, browserEv, summary }: { ev: EvidenceRecord<FetchPayload>; f: FetchPayload; b?: BrowserPayload; browserEv?: EvidenceRecord<BrowserPayload>; summary: ReportData["audit"]["summary"] }) {
  const x = summary?.extraction;
  return (
    <div className="space-y-6">
      {f.error ? <Banner tone="error" title={`Fetch could not read the page: ${f.error.code}`}>{f.error.message} This describes one Fetch request, not every AI tool.</Banner> : null}
      <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Requested URL"><span className="break-all">{f.requestedUrl}</span></Fact>
        <Fact label="Final URL after redirects">{f.finalUrl ? <span className="break-all">{f.finalUrl}{f.finalUrl !== f.requestedUrl ? " (redirected)" : ""}</span> : <span className="text-muted">Not provided</span>}</Fact>
        <Fact label="HTTP status"><span className="text-muted">Not provided by Fetch</span></Fact>
        <Fact label="Extracted title">{f.title ?? <span className="text-muted">None returned</span>}</Fact>
        <Fact label="Meta description">{f.description ?? <span className="text-muted">None returned</span>}</Fact>
        <Fact label="Language / latency">{f.language ?? "—"} · {f.latencyMs != null ? `${Math.round(f.latencyMs)} ms` : "latency n/a"}</Fact>
        <Fact label="Canonical (metadata)">{(f.pageMetadata?.canonical as string | undefined) ?? <span className="text-muted">Not observed</span>}</Fact>
        <Fact label="Retrieval">Live fetch requested; may be served from cache by TinyFish</Fact>
        <Fact label="Extracted size">{f.textLength.toLocaleString("en-US")} characters{f.textTruncated ? " (stored copy truncated)" : ""}</Fact>
      </dl>

      {x ? (
        <>
          <div>
            <h3 className="t-display-md">Heading hierarchy</h3>
            {x.headings.length === 0 ? <p className="mt-2 text-muted">No headings were found in the extracted content.</p> : (
              <ul className="mt-2 space-y-1 font-mono text-[13px]" aria-label="Heading outline">
                {x.headings.map((h, i) => <li key={i} style={{ paddingLeft: (h.level - 1) * 16 }}><span className="text-muted">H{h.level}</span> {h.text}</li>)}
              </ul>
            )}
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="t-display-md">Key facts extracted</h3>
              {x.facts.length ? (
                <ul className="mt-2 space-y-1 text-[15px]">{x.facts.map((fa, i) => <li key={i}><span className="chip-mono text-muted">{fa.type}</span> {fa.value}</li>)}</ul>
              ) : <p className="mt-2 text-muted">No prices, emails or phone numbers were detected in the extracted text.</p>}
              {x.entities.length ? (
                <>
                  <h4 className="eyebrow mt-4">Entities (AI-interpreted, quote verified)</h4>
                  <ul className="mt-2 space-y-1 text-[15px]">{x.entities.map((en, i) => <li key={i}><strong className="font-medium">{en.name}</strong> <span className="chip-mono text-muted">{en.type}</span></li>)}</ul>
                </>
              ) : null}
            </div>
            <div>
              <h3 className="t-display-md">Links and structured data</h3>
              <ul className="mt-2 space-y-1 text-[15px]">
                <li>Internal links: {x.internalLinks ?? <span className="text-muted">not returned</span>}</li>
                <li>External links: {x.externalLinks ?? <span className="text-muted">not returned</span>}</li>
                <li>Structured data: {b ? (b.jsonLd.length ? `${b.jsonLd.length} JSON-LD block(s): ${b.jsonLd.flatMap((j) => j.types).join(", ") || "no @type"}` : "none found in rendered page") : <span className="text-muted">Not collected (Fetch returns Markdown; needs browser verification)</span>}</li>
              </ul>
              {x.sampleInternalLinks.length ? <details className="mt-2 text-sm"><summary className="cursor-pointer text-muted">Sample internal links</summary><ul className="mt-1 space-y-0.5 break-all font-mono text-[12px]">{x.sampleInternalLinks.map((l) => <li key={l}>{l}</li>)}</ul></details> : null}
            </div>
          </div>
          <div>
            <h3 className="t-display-md">Content that appears absent from the extraction</h3>
            {b ? (x.absentFromExtraction.length ? (
              <ul className="mt-2 list-inside list-disc text-[15px]">{x.absentFromExtraction.map((h) => <li key={h}>“{h}” <span className="text-muted">(rendered in the browser, not in the Fetch text)</span></li>)}</ul>
            ) : <p className="mt-2 text-muted">Browser verification found no rendered headings that were missing from the Fetch text.</p>) : <p className="mt-2 text-muted">Not determined: it requires a rendered view. Run with browser verification set to “Always” to compare.</p>}
          </div>
          <details className="card p-0" open={undefined}>
            <summary className="flex min-h-11 cursor-pointer items-center justify-between px-4 py-3 font-medium">Main content excerpt (plain text) <ChevronDown size={16} aria-hidden /></summary>
            <div className="border-t border-hairline p-4"><p className="prose-evidence">{x.mainContentExcerpt}</p><p className="mt-2 text-xs text-muted">Shown as inert text. Fetched content is untrusted and is never rendered as HTML.</p></div>
          </details>
        </>
      ) : null}
      <p className="text-sm text-muted">Evidence: <EvLink id={ev.evidenceId} />{browserEv ? <> · <EvLink id={browserEv.evidenceId} /></> : null}</p>
    </div>
  );
}

function GapBlock({ gap, f, sEv, needsBrowser }: { gap: GapAnalysis; f?: FetchPayload; sEv?: EvidenceRecord<SearchPayload>; needsBrowser: boolean }) {
  const hit = sEv?.normalizedPayload.match ? sEv.normalizedPayload.results.find((r) => r.position === sEv.normalizedPayload.match!.position) : undefined;
  const semantic = gap.source === "deterministic+semantic";
  const h1 = f ? /^#\s+(.+)$/m.exec(f.text)?.[1] : undefined;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4">
          <p className="eyebrow">What the search result communicates</p>
          {hit ? <><p className="mt-2 font-medium">{hit.title}</p><p className="mt-1 text-sm text-[#333]">{hit.snippet || "No snippet returned."}</p></> : <p className="mt-2 text-muted">The page was not in the checked results, so there is no snippet to compare.</p>}
          {semantic && gap.searchCommunicates ? <p className="mt-3 border-t border-hairline pt-3 text-sm"><span className="badge mr-1">AI-interpreted</span>{gap.searchCommunicates}</p> : null}
        </div>
        <div className="card p-4">
          <p className="eyebrow">What the fetched page actually explains</p>
          {f && !f.error ? <><p className="mt-2 font-medium">{f.title ?? "(no title)"}</p><p className="mt-1 text-sm text-[#333]">{f.description ?? h1 ?? "No meta description returned."}</p></> : <p className="mt-2 text-muted">Fetch did not return page content.</p>}
          {semantic && gap.pageExplains ? <p className="mt-3 border-t border-hairline pt-3 text-sm"><span className="badge mr-1">AI-interpreted</span>{gap.pageExplains}</p> : null}
        </div>
      </div>

      {semantic && gap.purposeMatch ? (
        <div className="rounded-sm border border-hairline p-4">
          <p className="eyebrow">Does the page’s purpose match the query?</p>
          <p className="mt-1"><strong className="font-medium">{{ yes: "Yes", partial: "Partly", no: "No", unclear: "Unclear" }[gap.purposeMatch]}</strong> <span className="badge ml-1">AI-interpreted</span></p>
          <p className="mt-1 text-sm text-[#333]">{gap.purposeRationale}</p>
          {gap.snippetOmissions?.length ? <><p className="eyebrow mt-3">Useful details the snippet omits</p><ul className="mt-1 list-inside list-disc text-sm">{gap.snippetOmissions.map((s) => <li key={s}>{s}</li>)}</ul></> : null}
          <p className="mt-2 text-sm text-muted">Evidence: {gap.evidenceRefs.map((id) => <span key={id} className="mr-2"><EvLink id={id} /></span>)}</p>
        </div>
      ) : (
        <p className="rounded-sm border border-hairline bg-[#fafafa] p-3 text-sm text-muted">Semantic interpretation was not available for this audit; this section shows deterministic comparisons only.</p>
      )}

      <div>
        <h3 className="t-display-md">Query term coverage</h3>
        <p className="mt-1 text-sm text-muted">Are the query’s key terms stated where tools look first? Computed from the extracted page, not guessed.</p>
        {gap.coverage.length ? (
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[520px] border-collapse"><caption className="sr-only">Query term coverage</caption>
            <thead><tr>{["Term", "Title", "H1", "Description", "Body", "Search snippet"].map((h) => <th key={h} scope="col" className="th">{h}</th>)}</tr></thead>
            <tbody>{gap.coverage.map((c) => <tr key={c.term}><th scope="row" className="td font-medium">{c.term}</th><td className="td"><Tick v={c.inTitle} /></td><td className="td"><Tick v={c.inH1} /></td><td className="td"><Tick v={c.inDescription} /></td><td className="td"><Tick v={c.inBody} /></td><td className="td"><Tick v={c.inSnippet} /></td></tr>)}</tbody></table></div>
        ) : <p className="mt-2 text-muted">No query terms to measure.</p>}
      </div>

      {gap.snippetPhrasesNotOnPage.length ? (
        <div><h3 className="t-display-md">Snippet text not found on the extracted page</h3><ul className="mt-2 list-inside list-disc text-[15px]">{gap.snippetPhrasesNotOnPage.map((s) => <li key={s}>“{s}”</li>)}</ul></div>
      ) : null}
      {gap.competitorTerms.length ? (
        <div><h3 className="t-display-md">Terms competing results emphasise that the page does not state</h3>
          <p className="mt-2 flex flex-wrap gap-2">{gap.competitorTerms.map((t) => <span key={t.term} className="badge bg-canvas">{t.term} <span className="text-muted">×{t.competitors}</span></span>)}</p>
          <p className="mt-1 text-sm text-muted">Terms appearing in at least two other results. Hypotheses from a small sample, not requirements.</p></div>
      ) : null}
      {gap.notes.map((n) => <p key={n} className="text-sm text-muted">Note: {n}</p>)}
      {needsBrowser ? <Banner tone="warn" title="Requires browser verification">Fetch returned little or no content. Whether the content is missing or only rendered client-side cannot be settled without a browser. Re-run with verification set to “Always”.</Banner> : null}
      <p className="text-sm text-muted">Evidence: {gap.evidenceRefs.map((id) => <span key={id} className="mr-2"><EvLink id={id} /></span>)}</p>
    </div>
  );
}

function ChecksTable({ checks }: { checks: TechnicalCheck[] }) {
  if (!checks.length) return <EmptyState title="No technical checks ran">Checks need Fetch evidence. See the activity log.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <caption className="sr-only">Technical SEO checks</caption>
        <thead><tr>{["Check", "Status", "Observation", "Basis", "Evidence"].map((h) => <th key={h} scope="col" className="th">{h}</th>)}</tr></thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.checkId}>
              <th scope="row" className="td font-medium">{c.label}</th>
              <td className="td"><CheckBadge s={c.status} /></td>
              <td className="td">{c.observed}{c.note ? <span className="mt-1 block text-muted">{c.note}</span> : null}</td>
              <td className="td"><span className="chip-mono text-muted">{c.kind}</span></td>
              <td className="td">{c.evidenceRefs.length ? c.evidenceRefs.map((id) => <span key={id} className="mr-1 block"><EvLink id={id} /></span>) : <span className="text-faint">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingsBlock({ findings, print, status, hasEvidence }: { findings: Finding[]; print: boolean; status: string; hasEvidence: boolean }) {
  if (!findings.length) {
    return status === "failed" || !hasEvidence ? (
      <EmptyState title="Insufficient evidence">No usable evidence was collected, so SEOAuditor makes no findings rather than guessing. Check the activity log, then retry.</EmptyState>
    ) : (
      <EmptyState title="No findings">Nothing in the collected evidence met the threshold for a finding. That is not a guarantee of visibility: only the checks that ran are covered.</EmptyState>
    );
  }
  return (
    <ol className="space-y-3">
      {findings.map((f, i) => (
        <li key={f.findingId} className="print-block">
          <details id={`finding-${f.findingId}`} className="card group p-0" open={print || i === 0 || undefined}>
            <summary className="flex cursor-pointer flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
              <span className="min-w-0"><span className="mono-label text-muted">{f.findingId}</span> <span className="block text-[17px] font-medium sm:inline">{f.title}</span></span>
              <span className="flex shrink-0 flex-wrap items-center gap-2"><SeverityBadge s={f.severity} /><ConfidenceBadge c={f.confidence} /><ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden /></span>
            </summary>
            <div className="space-y-4 border-t border-hairline p-4">
              <div className="flex flex-wrap gap-2">
                <span className="badge bg-canvas">{f.origin === "deterministic" ? "Deterministic check" : "AI-interpreted"}</span>
                <span className="badge bg-canvas">{VSTATUS[f.verificationStatus]}</span>
                <span className="badge bg-canvas">{f.category}</span>
              </div>
              <Block title="What the evidence shows">{f.explanation}</Block>
              {f.excerpts.length ? (
                <div><p className="eyebrow">Evidence excerpt{f.excerpts.length > 1 ? "s" : ""}</p>{f.excerpts.map((e, k) => <blockquote key={k} className="prose-evidence mt-1 rounded-sm border border-hairline bg-[#fafafa] p-3">{e.text}<span className="mt-1 block text-muted">from <EvLink id={e.evidenceId} /></span></blockquote>)}</div>
              ) : <p className="text-sm text-muted">No verbatim excerpt is attached to this finding.</p>}
              <Block title="Why it may matter">{f.whyItMatters}</Block>
              <Block title="Recommended fix">{f.recommendedAction}</Block>
              {f.suggestedImplementation ? <div><p className="eyebrow">Suggested replacement copy or code</p><pre className="prose-evidence mt-1 overflow-x-auto rounded-sm bg-canvas-dark p-3 text-white">{f.suggestedImplementation}</pre></div> : null}
              <Block title="Expected outcome (no guarantee)">{f.expectedOutcome}</Block>
              <Block title="How to verify">{f.verificationMethod}</Block>
              <p className="text-sm text-muted">Evidence: {f.evidenceRefs.map((id) => <span key={id} className="mr-2"><EvLink id={id} /></span>)} · Section: <a className="underline" href={`#${f.reportSection}`}>{SECTION_LABEL[f.reportSection]}</a></p>
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div><p className="eyebrow">{title}</p><p className="mt-1 text-[15px]">{children}</p></div>
);

function EvidenceItem({ e, usedBy, open }: { e: EvidenceRecord; usedBy: string[]; open: boolean }) {
  return (
    <details id={`ev-${e.evidenceId}`} className="card group scroll-mt-20 p-0 print-block" open={open || undefined}>
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-4">
        <span className="min-w-0"><span className="mono-label font-medium">{e.evidenceId}</span> <span className="text-[15px]">{e.label}</span></span>
        <span className="flex items-center gap-2"><span className="badge bg-canvas">{e.sourceType}</span><ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden /></span>
      </summary>
      <div className="space-y-4 border-t border-hairline p-4 text-sm">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Fact label="Produced by">{e.endpoint}</Fact>
          <Fact label="Captured">{fmtDate(e.capturedAt)} · {e.retrieval === "live" ? "retrieved live" : "live fetch requested (cache possible)"}</Fact>
          <Fact label="Requested">{e.query ? `Query “${e.query}”` : e.sourceUrl ?? "—"}</Fact>
          <Fact label="Content hash"><span className="mono-label">{e.contentHash.slice(0, 16)}…</span></Fact>
          <Fact label="Used by">{usedBy.length ? usedBy.join(", ") : "No finding or check cites this record"}</Fact>
          <Fact label="Verification state">{e.sourceType === "browser" ? "Observed in a rendered page" : e.sourceType === "search" ? "Observed in a search response" : e.sourceType === "agent" ? "Agent session observation" : e.sourceType === "agent_run" ? "Provider execution status (not page content)" : "Directly observed from the source"}</Fact>
        </dl>
        <div><p className="eyebrow">Sanitized request and response metadata</p><pre className="prose-evidence mt-1 overflow-x-auto rounded-sm bg-[#fafafa] p-3">{json({ request: e.request, metadata: e.metadata })}</pre></div>
        <div><p className="eyebrow">Known limitations</p><ul className="mt-1 list-inside list-disc text-muted">{e.limitations.map((l) => <li key={l}>{l}</li>)}</ul></div>
        <details><summary className="cursor-pointer font-medium">Normalized data (JSON)</summary><pre className="prose-evidence mt-2 max-h-[420px] overflow-auto rounded-sm bg-[#fafafa] p-3">{json(e.normalizedPayload)}</pre></details>
      </div>
    </details>
  );
}
