"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AuditDoc, AuditStatus, LogEvent, StageRecord } from "@/lib/types";
import { TERMINAL } from "@/lib/types";
import { LogoLoader } from "./brand/Logo";
import { ProgressBar, Timeline, useNow } from "./Timeline";
import { AuditStatusBadge, Banner, ExtLink, fmtDuration } from "./ui";

interface Events {
  status: AuditStatus;
  stages: StageRecord[];
  log: LogEvent[];
  cancelRequested: boolean;
  startedAt: string | null;
  completedAt: string | null;
  evidence: { evidenceId: string; label: string; brief: string }[];
  errorSummary: string | null;
}

const WHAT_IS_HAPPENING: Record<string, string> = {
  validate_url: "Checking the URL is a public web address.",
  search: "Search in progress: asking TinyFish Search how this query returns results.",
  fetch: "Fetch in progress: retrieving the live page and extracting its content.",
  seo_checks: "Reading robots.txt and the sitemap and running deterministic checks.",
  browser_verify: "Browser verification in progress: rendering the page in a remote browser. This can take 30–60 seconds.",
  recommendations: "Generating recommendations from the collected evidence.",
  save: "Saving the report.",
};

/** Progress shown here is the persisted job state, polled from the server; nothing is simulated. */
export function LiveAudit({ initial }: { initial: AuditDoc }) {
  const router = useRouter();
  const [ev, setEv] = useState<Events>({
    status: initial.status, stages: initial.stages, log: initial.log, cancelRequested: initial.cancelRequested,
    startedAt: initial.startedAt ?? null, completedAt: initial.completedAt ?? null, evidence: [], errorSummary: null,
  });
  const [lost, setLost] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const done = useRef(false);
  const live = !TERMINAL.includes(ev.status);
  const now = useNow(live);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const failures = { n: 0 };
    async function tick() {
      try {
        const r = await fetch(`/api/audits/${initial.auditId}/events`, { cache: "no-store" });
        if (r.status === 401) return router.push(`/login?next=/audit/${initial.auditId}`);
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as Events;
        if (stop) return;
        setEv(j);
        failures.n = 0;
        setLost(0);
        if (TERMINAL.includes(j.status) && !done.current) {
          done.current = true;
          router.refresh(); // server component re-renders with the saved report
          return;
        }
      } catch {
        failures.n++;
        if (!stop) setLost(failures.n);
      }
      if (!stop) timer = setTimeout(tick, Math.min(1200 + failures.n * 800, 6000));
    }
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [initial.auditId, router]);

  async function cancel() {
    setCancelling(true);
    await fetch(`/api/audits/${initial.auditId}/cancel`, { method: "POST" });
  }

  const running = ev.stages.find((s) => s.status === "running");
  const elapsed = ev.startedAt ? (ev.completedAt ? Date.parse(ev.completedAt) : now) - Date.parse(ev.startedAt) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">Live audit</p>
          <h1 className="t-display-lg mt-1 break-words">{initial.label || "Audit in progress"}</h1>
          <p className="mt-1 text-muted"><ExtLink href={initial.targetUrl}>{initial.targetUrl}</ExtLink></p>
          {initial.queries.length ? <p className="mt-1 text-sm text-muted">Query: “{initial.queries[0]!.text}” <span className="badge">{initial.queries[0]!.source === "user" ? "user-provided" : "automatically generated"}</span></p> : <p className="mt-1 text-sm text-muted">No query: fetch-only audit.</p>}
        </div>
        <div className="flex items-center gap-3">
          <AuditStatusBadge s={ev.status} />
          <span className="mono-label text-muted" aria-label="Elapsed time">{ev.startedAt ? fmtDuration(elapsed) : "not started"}</span>
          {live ? <button onClick={cancel} disabled={cancelling || ev.cancelRequested} className="btn btn-outline btn-sm">{cancelling || ev.cancelRequested ? "Cancelling…" : "Cancel audit"}</button> : null}
        </div>
      </div>

      {lost >= 2 ? <Banner tone="warn" title="Connection to the server was interrupted">The audit keeps running on the server. Retrying automatically…</Banner> : null}
      {ev.status === "queued" ? (
        <div className="card flex items-center gap-4 p-5"><LogoLoader size={36} /><div><p className="font-medium">Waiting for audit execution</p><p className="text-sm text-muted">The audit is queued and will start in a moment.</p></div></div>
      ) : null}
      {ev.status === "waiting_config" ? <Banner tone="warn" title="Waiting for configuration">{ev.errorSummary ?? "An integration needs to be configured."} <a href="/setup" className="underline">Open setup</a></Banner> : null}
      {running && WHAT_IS_HAPPENING[running.stageId] ? <p className="rounded-sm border border-hairline bg-[#fafafa] p-3 text-sm" role="status">{WHAT_IS_HAPPENING[running.stageId]}</p> : null}

      <div className="card p-5">
        <ProgressBar stages={ev.stages} />
        <div className="mt-6"><Timeline stages={ev.stages} log={ev.log} evidence={ev.evidence} live={live} auditStatus={ev.status} /></div>
      </div>
    </div>
  );
}
