"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuditStatus, LogEvent, StageRecord } from "@/lib/types";
import { StageDot, cx, fmtClock, fmtDuration, stageLabel } from "./ui";

/** Ticks once per second, but only while `active`, so elapsed time is derived from real timestamps and nothing animates when idle. */
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const STATUS_TEXT: Record<string, string> = {
  queued: "text-muted",
  running: "text-ink",
  completed: "text-ink",
  failed: "text-crit",
  skipped: "text-muted",
  waiting_config: "text-med",
};

export function ProgressBar({ stages }: { stages: StageRecord[] }) {
  const done = stages.filter((s) => ["completed", "failed", "skipped", "waiting_config"].includes(s.status)).length;
  const color = (s: string) => ({ completed: "bg-ink", running: "bg-ink animate-pulse motion-reduce:animate-none", failed: "bg-crit", skipped: "bg-[#c8c8c8]", waiting_config: "bg-med", queued: "bg-hairline" })[s] ?? "bg-hairline";
  return (
    <div>
      <div className="flex gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={stages.length} aria-valuenow={done} aria-label={`${done} of ${stages.length} stages finished`}>
        {stages.map((s) => (
          <span key={s.stageId} title={`${s.label}: ${stageLabel(s.status)}`} className={cx("h-1.5 flex-1 rounded-[1px]", color(s.status))} />
        ))}
      </div>
      <p className="mono-label mt-1.5 text-muted">{done} of {stages.length} stages finished</p>
    </div>
  );
}

export function Timeline({ stages, log, evidence = [], live, auditStatus }: {
  stages: StageRecord[];
  log: LogEvent[];
  evidence?: { evidenceId: string; label: string; brief: string }[];
  live: boolean;
  auditStatus: AuditStatus;
}) {
  const now = useNow(live);
  const active = stages.find((s) => s.status === "running");
  return (
    <div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {active ? `${active.label}: running` : `Audit ${auditStatus}`}
      </div>
      <ol className="relative">
        {stages.map((s, i) => {
          const logs = log.filter((l) => l.stageId === s.stageId);
          const elapsed = s.status === "running" && s.startedAt ? now - Date.parse(s.startedAt) : s.durationMs;
          const ev = evidence.filter((e) => s.evidenceIds.includes(e.evidenceId));
          return (
            <li key={s.stageId} className="relative flex gap-3 pb-5 last:pb-0" aria-current={s.status === "running" ? "step" : undefined}>
              {i < stages.length - 1 ? <span aria-hidden className="absolute left-[13px] top-7 h-[calc(100%-28px)] w-px bg-hairline" /> : null}
              <StageDot s={s.status} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className={cx("text-[15px]", s.status === "queued" ? "text-muted" : "font-medium")}>{s.label}</p>
                  <p className="mono-label flex items-center gap-2 text-muted">
                    {s.attempt > 1 ? <span className="badge">attempt {s.attempt}</span> : null}
                    <span className={STATUS_TEXT[s.status]}>{stageLabel(s.status)}</span>
                    {elapsed != null && s.status !== "queued" ? <span>· {fmtDuration(elapsed)}</span> : null}
                  </p>
                </div>
                {s.message ? <p className={cx("mt-0.5 text-sm", s.status === "failed" ? "text-crit" : "text-muted")}>{s.message}</p> : null}
                {ev.length ? (
                  <ul className="mt-1.5 flex flex-wrap gap-2">
                    {ev.map((e) => (
                      <li key={e.evidenceId} className="badge bg-canvas" title={e.label}>
                        <span className="mono-label">{e.evidenceId}</span> <span className="text-muted">{e.brief}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {logs.length ? (
                  <details className="group mt-1.5">
                    <summary className="mono-label inline-flex cursor-pointer items-center gap-1 text-muted hover:text-ink">
                      <ChevronDown size={12} className="transition-transform group-open:rotate-180" aria-hidden /> Technical details ({logs.length})
                    </summary>
                    <ul className="mt-1.5 space-y-1 rounded-sm bg-[#fafafa] p-2.5">
                      {logs.map((l, k) => (
                        <li key={k} className="mono-label break-words leading-relaxed">
                          <span className="text-faint">{fmtClock(l.t)} UTC</span>{" "}
                          <span className={l.level === "error" ? "text-crit" : l.level === "warn" ? "text-med" : "text-[#333]"}>{l.message}</span>
                          {l.detail ? <span className="block pl-3 text-muted">{l.detail}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
