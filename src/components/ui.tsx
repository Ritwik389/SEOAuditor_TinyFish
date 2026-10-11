import { AlertOctagon, AlertTriangle, Check, CircleAlert, Clock, HelpCircle, Info, Loader2, Minus, Settings, SkipForward, X } from "lucide-react";
import type { ReactNode } from "react";
import type { AuditStatus, CheckStatus, Confidence, Severity, StageStatus } from "@/lib/types";
import { LogoMark } from "./brand/Logo";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Only http(s) links are ever rendered as anchors; everything else becomes plain text. */
export function safeHref(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? p.toString() : null;
  } catch {
    return null;
  }
}

export function ExtLink({ href, children, className }: { href: string | null | undefined; children: ReactNode; className?: string }) {
  const h = safeHref(href);
  if (!h) return <span className={className}>{children}</span>;
  return (
    <a href={h} target="_blank" rel="noopener noreferrer nofollow" className={cx("underline decoration-[#bbb] underline-offset-2 hover:decoration-ink break-all", className)}>
      {children}
    </a>
  );
}

export const fmtDuration = (ms?: number | null) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
// Deterministic (UTC, fixed format) so server-rendered and client-rendered HTML are identical: locale-dependent formatting caused hydration mismatches.
export const fmtDate = (iso?: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "—");
export const fmtClock = (iso: string) => iso.slice(11, 19);

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("eyebrow", className)}>{children}</p>;
}

const SEV: Record<Severity, { label: string; cls: string; icon: ReactNode }> = {
  critical: { label: "Critical", cls: "bg-crit-bg text-crit border-[#f4b3ad]", icon: <AlertOctagon size={13} aria-hidden /> },
  high: { label: "High", cls: "bg-high-bg text-high border-[#f9c79a]", icon: <AlertTriangle size={13} aria-hidden /> },
  medium: { label: "Medium", cls: "bg-med-bg text-med border-[#f0d58a]", icon: <CircleAlert size={13} aria-hidden /> },
  low: { label: "Low", cls: "bg-hairline text-[#333] border-[#d6d6d6]", icon: <Info size={13} aria-hidden /> },
};
export function SeverityBadge({ s }: { s: Severity }) {
  const v = SEV[s];
  return (
    <span className={cx("badge", v.cls)}>
      {v.icon}
      <span className="sr-only">Severity: </span>
      {v.label}
    </span>
  );
}
export const sevColor = (s: Severity) => ({ critical: "#b42318", high: "#d9650b", medium: "#c99a1a", low: "#9a9a9a" })[s];

export function ConfidenceBadge({ c }: { c: Confidence }) {
  return (
    <span className="badge bg-canvas text-ink">
      <span className="sr-only">Confidence: </span>
      {c === "high" ? "●●●" : c === "medium" ? "●●○" : "●○○"} <span className="text-muted">{c} confidence</span>
    </span>
  );
}

const CHECK: Record<CheckStatus, { label: string; cls: string; icon: ReactNode }> = {
  pass: { label: "Pass", cls: "bg-ok-bg text-ok border-[#a6e1c0]", icon: <Check size={13} aria-hidden /> },
  warning: { label: "Warning", cls: "bg-med-bg text-med border-[#f0d58a]", icon: <AlertTriangle size={13} aria-hidden /> },
  fail: { label: "Fail", cls: "bg-crit-bg text-crit border-[#f4b3ad]", icon: <X size={13} aria-hidden /> },
  not_checked: { label: "Not checked", cls: "bg-canvas text-muted border-[#d6d6d6] border-dashed", icon: <Minus size={13} aria-hidden /> },
  unknown: { label: "Unknown", cls: "bg-canvas text-muted border-[#d6d6d6]", icon: <HelpCircle size={13} aria-hidden /> },
};
export const checkLabel = (s: CheckStatus) => CHECK[s].label;
export function CheckBadge({ s }: { s: CheckStatus }) {
  const v = CHECK[s];
  return (
    <span className={cx("badge", v.cls)}>
      {v.icon}
      {v.label}
    </span>
  );
}

const STAGE: Record<StageStatus, { label: string; icon: ReactNode; cls: string }> = {
  queued: { label: "Queued", icon: <Clock size={16} aria-hidden />, cls: "text-faint border-hairline bg-canvas" },
  running: { label: "Running", icon: <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />, cls: "text-ink border-ink bg-canvas" },
  completed: { label: "Completed", icon: <Check size={16} aria-hidden />, cls: "text-white border-ink bg-ink" },
  failed: { label: "Failed", icon: <X size={16} aria-hidden />, cls: "text-white border-crit bg-crit" },
  skipped: { label: "Skipped", icon: <SkipForward size={14} aria-hidden />, cls: "text-muted border-[#bbb] bg-canvas border-dashed" },
  waiting_config: { label: "Waiting for configuration", icon: <Settings size={15} aria-hidden />, cls: "text-med border-[#e8c46a] bg-med-bg" },
};
export const stageLabel = (s: StageStatus) => STAGE[s].label;
export function StageDot({ s }: { s: StageStatus }) {
  const v = STAGE[s];
  return (
    <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-full border", v.cls)}>
      {v.icon}
      <span className="sr-only">{v.label}</span>
    </span>
  );
}

const AUDIT: Record<AuditStatus, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-canvas text-muted border-[#bbb]" },
  running: { label: "Running", cls: "bg-ink text-white border-ink" },
  completed: { label: "Completed", cls: "bg-ok-bg text-ok border-[#a6e1c0]" },
  partial: { label: "Partial report", cls: "bg-med-bg text-med border-[#f0d58a]" },
  failed: { label: "Failed", cls: "bg-crit-bg text-crit border-[#f4b3ad]" },
  cancelled: { label: "Cancelled", cls: "bg-hairline text-[#333] border-[#d6d6d6]" },
  waiting_config: { label: "Waiting for configuration", cls: "bg-med-bg text-med border-[#f0d58a]" },
};
export const auditLabel = (s: AuditStatus) => AUDIT[s].label;
export function AuditStatusBadge({ s }: { s: AuditStatus }) {
  return <span className={cx("badge", AUDIT[s].cls)}>{AUDIT[s].label}</span>;
}

export function DemoBadge() {
  return <span className="badge border-ink bg-mint text-ink chip-mono">Demo · sample data</span>;
}

export function Banner({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "error" | "ok"; title: string; children?: ReactNode; action?: ReactNode }) {
  const t = { info: "border-[#c9d3f5] bg-info-bg", warn: "border-[#f0d58a] bg-med-bg", error: "border-[#f4b3ad] bg-crit-bg", ok: "border-[#a6e1c0] bg-ok-bg" }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("flex flex-col gap-3 rounded-sm border p-4 sm:flex-row sm:items-center sm:justify-between", t)}>
      <div>
        <p className="font-medium">{title}</p>
        {children ? <div className="mt-1 text-sm text-[#333]">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

/** Used for every empty / not-yet-configured state: says what happened and what to do next. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <LogoMark size={44} className="text-ink" />
      <h2 className="t-display-md">{title}</h2>
      {children ? <div className="max-w-xl text-muted">{children}</div> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
