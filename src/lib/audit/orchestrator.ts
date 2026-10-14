import { randomUUID } from "node:crypto";
import { analyzeDeterministic } from "../analysis";
import { collectSiteFiles } from "../analysis/robots";
import { assignIds, prioritize } from "../analysis/findings";
import { mergeSemanticGap, runSemanticAnalysis } from "../analysis/semantic";
import { getCredential, getSettings, type Settings } from "../config";
import { claimAudit, cleanupOld, getAudit, listEvidence, patchAudit, replaceFindings, saveEvidence } from "../db/repo";
import { getAnalysisProvider, type AnalysisProvider } from "../gemini/provider";
import { log } from "../logger";
import { redact } from "../security/redact";
import { sha256 } from "../security/crypto";
import { validateTargetUrl } from "../security/ssrf";
import { TinyFishError } from "../tinyfish/client";
import { verifyInBrowser } from "../tinyfish/browser";
import { verifyWithAgent } from "../tinyfish/agent";
import { tfFetch } from "../tinyfish/fetch";
import { tfSearch } from "../tinyfish/search";
import { matchTarget } from "../url";
import {
  SCHEMA_VERSION, STAGES,
  type AgentPayload, type AuditDoc, type AuditStatus, type AuditSummary, type BrowserPayload, type EvidenceKind, type EvidenceRecord, type FetchPayload, type Finding,
  type LogEvent, type RobotsPayload, type SearchPayload, type SitemapPayload, type StageId, type StageRecord, type StageStatus,
} from "../types";

export interface Deps {
  search: typeof tfSearch;
  fetch: typeof tfFetch;
  browser: typeof verifyInBrowser;
  agent: typeof verifyWithAgent;
  siteFiles: typeof collectSiteFiles;
  /** All three resolve the OWNER's own credentials/settings; there is no shared deployment key. */
  provider: (ownerId: string) => Promise<AnalysisProvider | null>;
  apiKey: (ownerId: string) => Promise<string | null>;
  settings: (ownerId: string) => Promise<Settings>;
  onUpdate?: () => Promise<void>;
  signal?: AbortSignal;
}

export const defaultDeps: Deps = {
  search: tfSearch,
  fetch: tfFetch,
  browser: verifyInBrowser,
  agent: verifyWithAgent,
  siteFiles: collectSiteFiles,
  provider: getAnalysisProvider,
  apiKey: (ownerId) => getCredential(ownerId, "tinyfish"),
  settings: getSettings,
};

class Cancelled extends Error {}

export function initialStages(): StageRecord[] {
  return STAGES.map((s) => ({ stageId: s.id, label: s.label, provider: s.provider, status: "queued" as StageStatus, attempt: 0, evidenceIds: [] }));
}

/** Legal audit status transitions. Terminal states never change (retry creates a new audit). */
const NEXT: Record<AuditStatus, AuditStatus[]> = {
  queued: ["running", "cancelled", "failed", "waiting_config"],
  running: ["completed", "partial", "failed", "cancelled"],
  completed: [], partial: [], failed: [], cancelled: [], waiting_config: [],
};
export const canTransition = (from: AuditStatus, to: AuditStatus) => NEXT[from].includes(to);

const STALE_MS = 6 * 60_000;
/** An audit whose function died mid-run would otherwise look "running" forever. */
export async function reconcileStale(a: AuditDoc): Promise<AuditDoc> {
  if (a.status !== "running" && a.status !== "queued") return a;
  if (Date.now() - Date.parse(a.updatedAt) < STALE_MS) return a;
  const stages = a.stages.map((s) => (s.status === "running" || s.status === "queued" ? { ...s, status: "failed" as StageStatus, error: "Interrupted before completion." } : s));
  const patch = { status: "failed" as AuditStatus, stages, errorSummary: "The audit was interrupted (the server function stopped before it finished). Use Retry to run it again.", completedAt: new Date().toISOString() };
  await patchAudit(a.auditId, patch);
  return { ...a, ...patch };
}

class Run {
  stages = new Map<StageId, StageRecord>();
  logs: LogEvent[];
  evidence: EvidenceRecord[] = [];
  unsaved: EvidenceRecord[] = [];
  /** Search evidence is held back until result matching is final (needs the Fetch canonical/final URL). */
  deferred: EvidenceRecord[] = [];
  counters: Record<string, number> = {};
  ctl = new AbortController();
  cancelled = false;
  chain: Promise<unknown> = Promise.resolve();
  calls: AuditSummary["apiCalls"] = { search: 0, fetch: 0, browser: 0, gemini: 0 };
  private watcher?: ReturnType<typeof setInterval>;

  constructor(public a: AuditDoc, private onUpdate?: () => Promise<void>) {
    // Queued audits created by an older build may not yet contain new stages.
    initialStages().forEach((s) => this.stages.set(s.stageId, s));
    a.stages.forEach((s) => this.stages.set(s.stageId, { ...s }));
    this.logs = [...a.log];
  }

  watchCancel() {
    this.watcher = setInterval(async () => {
      try {
        if ((await getAudit(this.a.auditId, null))?.cancelRequested && !this.cancelled) {
          this.cancelled = true;
          this.ctl.abort(new DOMException("cancelled", "AbortError"));
        }
      } catch { /* DB hiccup: next tick */ }
    }, 1500);
  }
  stopWatch() { clearInterval(this.watcher); }
  check() { if (this.cancelled) throw new Cancelled(); }

  flush(extra: Partial<AuditDoc> = {}) {
    const snapshot = { stages: STAGES.map((s) => this.stages.get(s.id)!), log: this.logs.slice(-300), ...extra };
    this.chain = this.chain.then(async () => {
      await patchAudit(this.a.auditId, snapshot);
      await this.onUpdate?.();
    }).catch((e) => log("error", "flush failed", { err: redact(e) }));
    return this.chain;
  }

  note(stageId: StageId | "audit", level: LogEvent["level"], message: string, detail?: string) {
    this.logs.push({ t: new Date().toISOString(), stageId, level, message, detail: detail ? redact(detail).slice(0, 1500) : undefined });
  }

  start(id: StageId, message?: string) {
    const s = this.stages.get(id)!;
    Object.assign(s, { status: "running", startedAt: new Date().toISOString(), message, attempt: Math.max(s.attempt, 1) });
    this.note(id, "info", message ?? `${s.label}…`);
    return this.flush({ currentStage: id });
  }
  attempt(id: StageId) { return (n: number) => { this.stages.get(id)!.attempt = n; if (n > 1) this.note(id, "warn", `Retrying (attempt ${n})`); void this.flush(); }; }
  end(id: StageId, status: StageStatus, message?: string, error?: string) {
    const s = this.stages.get(id)!;
    const now = Date.now();
    Object.assign(s, { status, completedAt: new Date(now).toISOString(), message: message ?? s.message, error: error ? redact(error).slice(0, 500) : undefined });
    if (s.startedAt) s.durationMs = now - Date.parse(s.startedAt);
    this.note(id, status === "failed" ? "error" : status === "skipped" ? "warn" : "info", message ?? status, error);
    return this.flush();
  }

  ev<P>(kind: EvidenceKind, stage: StageId, d: { label: string; endpoint: string; sourceUrl?: string; query?: string; request: Record<string, unknown>; payload: P; metadata?: Record<string, unknown>; limitations: string[]; retrieval?: "live" | "live-or-cache"; hashOf?: string; defer?: boolean }) {
    const n = (this.counters[kind] = (this.counters[kind] ?? 0) + 1);
    const rec: EvidenceRecord<P> = {
      evidenceId: `ev_${kind}_${n}`, auditId: this.a.auditId, sourceType: kind, label: d.label, endpoint: d.endpoint, sourceUrl: d.sourceUrl, query: d.query,
      capturedAt: new Date().toISOString(), retrieval: d.retrieval ?? "live", request: d.request, normalizedPayload: d.payload,
      contentHash: sha256(d.hashOf ?? JSON.stringify(d.payload)), metadata: d.metadata ?? {}, limitations: d.limitations, schemaVersion: SCHEMA_VERSION,
    };
    this.evidence.push(rec as EvidenceRecord);
    (d.defer ? this.deferred : this.unsaved).push(rec as EvidenceRecord);
    this.stages.get(stage)!.evidenceIds.push(rec.evidenceId);
    return rec;
  }
  async persistEvidence(all = false) {
    const batch = [...this.unsaved.splice(0), ...(all ? this.deferred.splice(0) : [])];
    if (batch.length) await saveEvidence(batch);
  }
}

const SEARCH_LIMITS = [
  "One search request returning a single page of results from TinyFish Search; the sample size is the number of results returned.",
  "The result order reflects TinyFish's source, not a guaranteed Google or Bing ranking.",
  "'Not found' means not present in this sample. It does not mean the page is unindexed.",
];

export async function runAudit(auditId: string, deps: Deps = defaultDeps): Promise<void> {
  if (!(await claimAudit(auditId))) return; // another invocation owns it, or it was cancelled before start
  const audit = (await getAudit(auditId, null))!;
  const run = new Run(audit, deps.onUpdate);
  const abort = () => { run.cancelled = true; run.ctl.abort(new DOMException("cancelled", "AbortError")); };
  deps.signal?.addEventListener("abort", abort, { once: true });
  if (deps.signal?.aborted) abort();
  run.watchCancel();
  const settings = await deps.settings(audit.ownerId);
  const key = await deps.apiKey(audit.ownerId);
  let status: AuditStatus = "completed";
  let errorSummary: string | undefined;
  let interrupted = false; // set when cancelled or crashed; normal completion writes its own final state

  try {
    run.check();
    if (!key) {
      for (const s of STAGES) if (s.provider.startsWith("tinyfish")) run.stages.get(s.id)!.status = "waiting_config";
      run.note("audit", "error", "TinyFish API key is not configured.");
      await run.flush();
      await patchAudit(auditId, { status: "waiting_config", errorSummary: "TinyFish is not configured for this account. Add your API key on the Setup page, then retry.", completedAt: new Date().toISOString() });
      return;
    }

    // 1 — validate -------------------------------------------------------------------------
    await run.start("validate_url");
    try {
      await validateTargetUrl(audit.targetUrl);
      await run.end("validate_url", "completed", "URL is public http(s); DNS resolves to public addresses only.");
    } catch (e) {
      await run.end("validate_url", "failed", "The URL was rejected.", e instanceof Error ? e.message : "invalid");
      throw new FatalAudit(e instanceof Error ? e.message : "URL rejected");
    }
    run.check();

    // 2 — query -----------------------------------------------------------------------------
    await run.start("prepare_query");
    const queries = audit.queries;
    await run.end("prepare_query", queries.length ? "completed" : "skipped", queries.length ? `${queries.length} quer${queries.length > 1 ? "ies" : "y"} ready (${queries.map((q) => (q.source === "user" ? "user-provided" : "auto-generated")).join(", ")}).` : "No query supplied. Search is skipped; this is a fetch-only audit.");

    // 3 + 5 — search and fetch run concurrently ------------------------------------------------
    const searches: { evidenceId: string; payload: SearchPayload }[] = [];
    const searchTask = (async () => {
      if (!queries.length) {
        await run.end("search", "skipped", "No query to search for.");
        return;
      }
      await run.start("search", `Searching ${queries.length} quer${queries.length > 1 ? "ies" : "y"} with TinyFish Search…`);
      for (const q of queries) {
        run.check();
        try {
          run.calls.search++;
          const o = await deps.search(key, { query: q.text, location: audit.settings.location, language: audit.settings.language, purpose: "Check whether a target page appears for the query it is meant to rank for.", signal: run.ctl.signal, onAttempt: run.attempt("search") });
          const payload: SearchPayload = { query: o.query, location: audit.settings.location, language: audit.settings.language, page: o.page, totalResults: o.totalResults, results: o.results, match: null };
          const rec = run.ev("search", "search", { label: `Search: ${q.text}`, endpoint: "GET api.search.tinyfish.ai", query: q.text, request: { query: q.text, location: audit.settings.location, language: audit.settings.language }, payload, metadata: { requestId: o.requestId, latencyMs: o.latencyMs }, limitations: SEARCH_LIMITS, defer: true });
          searches.push({ evidenceId: rec.evidenceId, payload });
          run.note("search", "info", `"${q.text}": ${o.results.length} results returned`);
        } catch (e) {
          if (run.cancelled) throw new Cancelled();
          run.note("search", "error", `Search failed for "${q.text}"`, errText(e));
        }
      }
      const ok = searches.length;
      await run.end("search", ok === 0 ? "failed" : "completed", ok === 0 ? "TinyFish Search failed for every query." : `${ok}/${queries.length} search${ok > 1 ? "es" : ""} returned results.`, ok === 0 ? "See activity log." : undefined);
    })();

    let fetchEv: { evidenceId: string; payload: FetchPayload } | undefined;
    const fetchTask = (async () => {
      await run.start("fetch", "Fetching the page with TinyFish Fetch…");
      try {
        run.calls.fetch++;
        const o = await deps.fetch(key, { url: audit.targetUrl, maxChars: settings.maxEvidenceChars, signal: run.ctl.signal, onAttempt: run.attempt("fetch") });
        const rec = run.ev("fetch", "fetch", {
          label: "Fetch: target page", endpoint: "POST api.fetch.tinyfish.ai", sourceUrl: audit.targetUrl,
          request: { urls: [audit.targetUrl], format: "markdown", links: true, page_metadata: true, ttl: 0 }, payload: o.payload,
          metadata: { requestId: o.requestId, latencyMs: o.latencyMs }, retrieval: "live-or-cache", hashOf: o.payload.text || JSON.stringify(o.payload.error),
          limitations: [
            "Fetch returns extracted Markdown, not raw HTML: HTTP status codes, response headers, JSON-LD and exact markup are not available from this evidence.",
            "ttl=0 requests a live fetch, but TinyFish may serve a cached copy when the origin's Cache-Control permits it.",
            "Success of this request does not show the page is indexable or accessible to every crawler.",
          ],
        });
        fetchEv = { evidenceId: rec.evidenceId, payload: o.payload };
        await run.persistEvidence();
        if (o.payload.error) await run.end("fetch", "failed", `Fetch could not read the page: ${o.payload.error.message}`, o.payload.error.code);
        else await run.end("fetch", "completed", `Fetched ${o.payload.textLength.toLocaleString("en-US")} characters${o.payload.finalUrl && o.payload.finalUrl !== audit.targetUrl ? ` (redirected to ${o.payload.finalUrl})` : ""}.`);
      } catch (e) {
        if (run.cancelled) throw new Cancelled();
        await run.end("fetch", "failed", friendly(e, "TinyFish Fetch request failed."), errText(e));
      }
    })();

    const settled = await Promise.allSettled([searchTask, fetchTask]);
    if (settled.some((s) => s.status === "rejected" && s.reason instanceof Cancelled)) throw new Cancelled();
    run.check();

    // 4 — inspect results (match with final URL / canonical now that Fetch has settled) -----------------
    await run.start("inspect_results");
    if (!searches.length) {
      await run.end("inspect_results", "skipped", queries.length ? "No search results to inspect." : "Search was not run.");
    } else {
      const f = fetchEv?.payload;
      for (const s of searches) {
        for (const r of s.payload.results) {
          const m = matchTarget(audit.targetUrl, r.url, { finalUrl: f?.finalUrl, canonical: f?.pageMetadata?.canonical });
          if (m && (!s.payload.match || r.position < s.payload.match.position)) s.payload.match = { position: r.position, method: m.method, url: r.url };
        }
        const rec = run.evidence.find((e) => e.evidenceId === s.evidenceId)!;
        rec.normalizedPayload = s.payload;
        rec.contentHash = sha256(JSON.stringify(s.payload));
      }
      run.unsaved.push(...run.deferred.splice(0));
      await run.persistEvidence();
      const found = searches.filter((s) => s.payload.match);
      await run.end("inspect_results", "completed", found.length ? `Target found for ${found.length}/${searches.length} quer${searches.length > 1 ? "ies" : "y"} (best position ${Math.min(...found.map((s) => s.payload.match!.position))}).` : "Target not found in the checked results.");
    }
    run.check();

    // 6 — extract ---------------------------------------------------------------------------------
    await run.start("extract");
    if (!fetchEv || fetchEv.payload.error) await run.end("extract", "skipped", "No page content to extract (Fetch did not succeed).");
    else await run.end("extract", "completed", "Headings, facts and links extracted from the Fetch output.");

    // 7 — compare (deterministic part now; semantic part in recommendations) ----------------------------
    await run.start("compare");
    await run.end("compare", fetchEv && !fetchEv.payload.error ? "completed" : "skipped", fetchEv && !fetchEv.payload.error ? "Query terms checked against title, headings, description, body and search snippets." : "Skipped: needs fetched page content.");

    // 8 — technical checks (robots.txt + sitemap via SSRF-safe fetch) ---------------------------------------
    await run.start("seo_checks", "Reading robots.txt and the sitemap, running deterministic checks…");
    let robots: { evidenceId: string; payload: RobotsPayload } | undefined;
    let sitemap: { evidenceId: string; payload: SitemapPayload } | undefined;
    try {
      const sf = await deps.siteFiles(audit.targetUrl, run.ctl.signal);
      const r = run.ev("robots", "seo_checks", { label: "robots.txt", endpoint: "GET {origin}/robots.txt (SEOAuditor server, SSRF-guarded)", sourceUrl: sf.robots.url, request: { url: sf.robots.url }, payload: sf.robots, limitations: ["Fetched directly by SEOAuditor, not by TinyFish. Rules are evaluated for the generic agent and a fixed list of AI crawler names only."] });
      robots = { evidenceId: r.evidenceId, payload: sf.robots };
      if (sf.sitemap) {
        const s = run.ev("sitemap", "seo_checks", { label: "Sitemap", endpoint: "GET sitemap (SEOAuditor server, SSRF-guarded)", sourceUrl: sf.sitemap.url, request: { url: sf.sitemap.url }, payload: sf.sitemap, limitations: ["Only the first sitemap is read; sitemap indexes are not traversed; large files are truncated."] });
        sitemap = { evidenceId: s.evidenceId, payload: sf.sitemap };
      }
      await run.persistEvidence();
      await run.end("seo_checks", "completed", "Technical checks complete.");
    } catch (e) {
      if (run.cancelled) throw new Cancelled();
      await run.end("seo_checks", "completed", "Page-level checks complete; robots.txt/sitemap could not be read.", errText(e));
    }
    run.check();

    // 9 — browser verification ---------------------------------------------------------------------------------
    await run.start("browser_verify");
    let browser: { evidenceId: string; payload: BrowserPayload } | undefined;
    let browserState: "verified" | "skipped" | "failed" | "unavailable" = "skipped";
    const objective = browserObjective(audit.settings.verification, fetchEv?.payload);
    if (!objective) {
      await run.end("browser_verify", "skipped", audit.settings.verification === "off" ? "Verification is turned off for this audit." : "No verification objective: Search and Fetch evidence was sufficient.");
    } else {
      try {
        run.note("browser_verify", "info", `Objective: ${objective}`);
        run.calls.browser++;
        const o = await deps.browser(key, { url: fetchEv?.payload.finalUrl ?? audit.targetUrl, objective, fetchText: fetchEv?.payload.text ?? "", signal: run.ctl.signal, onAttempt: run.attempt("browser_verify") });
        const rec = run.ev("browser", "browser_verify", { label: "Browser: rendered page", endpoint: "POST api.browser.tinyfish.ai + CDP", sourceUrl: audit.targetUrl, request: { url: audit.targetUrl, objective }, payload: o.payload, metadata: { sessionId: o.sessionId, requestId: o.requestId }, limitations: ["A single browser session from TinyFish's network; content personalised by location, cookies or A/B tests may differ for other visitors."] });
        browser = { evidenceId: rec.evidenceId, payload: o.payload };
        browserState = "verified";
        await run.persistEvidence();
        await run.end("browser_verify", "completed", `Rendered ${o.payload.visibleTextLength.toLocaleString("en-US")} characters; ${o.payload.missingFromFetch.length} heading(s) absent from Fetch output.`);
      } catch (e) {
        if (run.cancelled) throw new Cancelled();
        browserState = e instanceof TinyFishError && [402, 403, 404].includes(e.status) ? "unavailable" : "failed";
        await run.end("browser_verify", "failed", browserState === "unavailable" ? "Browser verification is not available for this account." : friendly(e, "Browser verification failed."), errText(e));
      }
    }
    run.check();

    // 10 — Agent checks content behind interactions, with a separately tracked provider run ------------------------------
    let agent: { evidenceId: string; payload: AgentPayload } | undefined;
    let agentState: NonNullable<AuditSummary["agent"]> = "skipped";
    if (!audit.settings.agentVerification) {
      await run.end("agent_verify", "skipped", "Agent interaction check was not selected for this audit.");
    } else {
      await run.start("agent_verify", "Opening relevant read-only page controls with TinyFish Agent…");
      try {
        const fetchComplete = !!fetchEv && !fetchEv.payload.error && !fetchEv.payload.textTruncated && !!fetchEv.payload.text.trim();
        const o = await deps.agent(key, {
          url: audit.targetUrl, query: queries[0]?.text, fetchText: fetchEv?.payload.text ?? "", fetchComplete, signal: run.ctl.signal,
          onCall: (kind) => { run.calls[kind] = (run.calls[kind] ?? 0) + 1; },
          onRun: async (event) => {
            run.ev("agent_run", "agent_verify", {
              label: `Agent run: ${event.payload.status}`, endpoint: event.endpoint, sourceUrl: audit.targetUrl,
              request: { runId: event.payload.runId }, payload: event.payload,
              metadata: { requestId: event.requestId, latencyMs: event.latencyMs },
              limitations: ["The provider run state describes execution, not the accuracy of its extracted content.", ...(event.payload.status === "SUBMITTED" ? ["This is a create acknowledgment; the run status has not yet been polled."] : [])],
            });
            // Persist the ID immediately so an interrupted audit retains its provider trace.
            await run.persistEvidence();
            run.note("agent_verify", "info", `Provider run ${event.payload.runId}: ${event.payload.status}`);
            await run.flush();
          },
        });
        const rec = run.ev("agent", "agent_verify", {
          label: "Agent: answers behind page interactions", endpoint: "POST agent.tinyfish.ai/v1/automation/run-async + GET agent.tinyfish.ai/v1/runs/{id}",
          sourceUrl: audit.targetUrl, request: { url: audit.targetUrl, query: queries[0]?.text, browser_profile: "lite", max_duration_seconds: 90 }, payload: o.payload,
          metadata: { runId: o.runId, status: o.status, requestId: o.requestId, fetchComparison: fetchComplete && o.payload.fetchComparison !== "unmeasured" ? "complete" : "unmeasured" },
          limitations: ["Agent observations are model-produced and are not an independent DOM capture. Quotes are checked for containment in the Agent's own text sample.", "Only up to four relevant read-only controls are checked. Missing content here does not establish that all users or crawlers are blocked.", "Content absent from the Fetch sample may result from truncation, timing or personalization, as well as page interactions."],
        });
        agent = { evidenceId: rec.evidenceId, payload: o.payload };
        agentState = "verified";
        await run.persistEvidence();
        const comparisonMessage = fetchComplete && o.payload.fetchComparison !== "unmeasured" ? `${o.payload.missingFromFetch.length} quote(s) absent from Fetch.` : "comparison to Fetch was not measured because its sample was unavailable or incomplete.";
        await run.end("agent_verify", "completed", `Agent reported ${o.payload.interactions.length} interaction(s), ${o.payload.answers.length} answer(s); ${comparisonMessage}`);
      } catch (e) {
        if (run.cancelled) throw new Cancelled();
        agentState = e instanceof TinyFishError && [402, 403, 404].includes(e.status) ? "unavailable" : "failed";
        await run.end("agent_verify", "failed", agentState === "unavailable" ? "Agent verification is not available for this account." : friendly(e, "Agent verification failed; Search and Fetch evidence is retained."), errText(e));
      }
    }
    run.check();

    // 11 — recommendations -------------------------------------------------------------------------------------------
    await run.start("recommendations");
    const det = analyzeDeterministic({ auditId, targetUrl: audit.targetUrl, queries, searches, fetch: fetchEv, browser, agent, robots, sitemap });
    let findings: Finding[] = det.findings;
    let gaps = det.gaps;
    let extraction = det.extraction;
    let semantic: "used" | "unavailable" | "failed" = "unavailable";
    const provider = await deps.provider(audit.ownerId);
    const canSemantic = !!provider && (searches.length > 0 || (fetchEv && !fetchEv.payload.error));
    if (!provider) await run.end("recommendations", "skipped", "Gemini is not configured. Report contains deterministic findings only.");
    else if (!canSemantic) await run.end("recommendations", "skipped", "No usable evidence for semantic analysis. Deterministic findings only.");
    else {
      try {
        const primary = queries[0]?.text ?? "(no query supplied)";
        const r = await runSemanticAnalysis(provider, { auditId, query: primary, evidence: run.evidence, signal: run.ctl.signal });
        run.calls.gemini += r.calls;
        findings = assignIds(auditId, [...det.findings, ...r.findings].map(({ findingId, ...rest }) => { void findingId; return { ...rest, origin: rest.origin }; }));
        if (gaps[0]) gaps = [mergeSemanticGap(gaps[0], r.output.gap), ...gaps.slice(1)];
        if (extraction) extraction = { ...extraction, entities: r.output.entities.map(({ name, type, excerpt }) => ({ name, type, excerpt })) };
        semantic = "used";
        await run.end("recommendations", "completed", `${findings.length} findings (${r.findings.length} from ${provider.model}${r.dropped ? `, ${r.dropped} unsupported dropped` : ""}).`);
      } catch (e) {
        if (run.cancelled) throw new Cancelled();
        semantic = "failed";
        await run.end("recommendations", "failed", "Semantic analysis failed; deterministic findings are still included.", errText(e));
      }
    }
    if (semantic === "unavailable" && !provider) run.note("recommendations", "warn", "Semantic layer unavailable");
    run.check();

    // 12 — save --------------------------------------------------------------------------------------------------------
    await run.start("save");
    findings = prioritize(findings);
    const primarySearch = searches.find((s) => s.payload.query === queries[0]?.text);
    const hasAnyEvidence = searches.length > 0 || (!!fetchEv && !fetchEv.payload.error) || !!agent;
    await replaceFindings(auditId, findings);
    const summary = {
      search: !queries.length ? ("not_run" as const) : primarySearch ? (primarySearch.payload.match ? ("found" as const) : ("not_found" as const)) : ("failed" as const),
      searchPosition: primarySearch?.payload.match?.position,
      fetch: !fetchEv ? ("failed" as const) : fetchEv.payload.error ? ("failed" as const) : ("ok" as const),
      browser: browserState,
      agent: agentState,
      findingsCount: findings.length,
      topIssue: findings[0]?.title,
      firstAction: findings[0]?.recommendedAction,
      apiCalls: run.calls,
      semanticAnalysis: semantic,
      extraction, gaps, checks: det.checks,
    };
    const anyFailed = [...run.stages.values()].some((s) => s.status === "failed");
    // A page-level fetch error (e.g. bot_blocked) still yields a real finding, so that is "partial", not "failed".
    status = !hasAnyEvidence && !findings.length ? "failed" : anyFailed ? "partial" : "completed";
    await run.end("save", "completed", `Report saved (${status}).`);
    await run.flush();
    await patchAudit(auditId, { summary, status, completedAt: new Date().toISOString(), currentStage: undefined, errorSummary: status === "failed" ? "No usable evidence could be collected. See the activity log." : undefined });
    void cleanupOld(settings.retentionDays, audit.ownerId).catch(() => undefined);
    return;
  } catch (e) {
    interrupted = true;
    if (e instanceof Cancelled || run.cancelled) {
      status = "cancelled";
      for (const s of run.stages.values()) if (s.status === "running" || s.status === "queued") { s.status = "skipped"; s.message = "Cancelled before this stage finished."; }
      run.note("audit", "warn", "Audit cancelled by user.");
    } else {
      status = "failed";
      errorSummary = e instanceof FatalAudit ? e.message : "The audit stopped because of an unexpected error.";
      for (const s of run.stages.values()) {
        if (s.status === "running") { s.status = "failed"; s.error = redact(e).slice(0, 300); }
        else if (s.status === "queued") { s.status = "skipped"; s.message = "Not run because the audit stopped earlier."; }
      }
      run.note("audit", "error", errorSummary, e instanceof FatalAudit ? undefined : errText(e));
      log("error", "audit crashed", { auditId, err: redact(e) });
    }
  } finally {
    deps.signal?.removeEventListener("abort", abort);
    run.stopWatch();
    try { await run.persistEvidence(true); } catch { /* best effort */ }
    if (interrupted) {
      await run.flush();
      await patchAudit(auditId, { status, errorSummary, completedAt: new Date().toISOString(), currentStage: undefined });
    }
    await deps.onUpdate?.();
  }
}

class FatalAudit extends Error {}

function errText(e: unknown): string {
  if (e instanceof TinyFishError) return `${e.code} (HTTP ${e.status || "n/a"})${e.requestId ? ` request ${e.requestId}` : ""}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
function friendly(e: unknown, fallback: string): string {
  return e instanceof TinyFishError ? e.message : fallback;
}

/** Browser runs only with a concrete objective (or when the user turned verification on). */
export function browserObjective(mode: AuditDoc["settings"]["verification"], f?: FetchPayload): string | null {
  if (mode === "off") return null;
  if (mode === "always") return "Verification requested: compare the rendered page with the Fetch extraction.";
  if (!f) return null;
  if (f.error) {
    if (["empty_content", "bot_blocked", "timeout"].includes(f.error.code)) return `Fetch failed with ${f.error.code}: check whether the page renders for a real browser.`;
    return null;
  }
  const wc = (f.text.match(/\S+/g) ?? []).length;
  if (wc < 150) return `Fetch extracted only ${wc} words: check whether more content appears after rendering.`;
  if (!/^#{1,2}\s/m.test(f.text)) return "No headings were extracted: check whether the page renders a heading structure.";
  return null;
}

export function newAuditId() {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}
