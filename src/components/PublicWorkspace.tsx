"use client";

import Link from "next/link";
import { useState } from "react";
import { publicStorageWarning, usePublicReports } from "@/lib/public-audits";
import { TERMINAL } from "@/lib/types";
import { AuditStatusBadge, Banner, EmptyState, fmtDate } from "./ui";
import { LiveAudit } from "./LiveAudit";
import { PrintButton, ReportActions } from "./ReportActions";
import { ReportView } from "./report/ReportView";

export function PublicAuditView({ id, print = false }: { id: string; print?: boolean }) {
  const reports = usePublicReports();
  if (!reports) return <p role="status" className="text-muted">Opening audit…</p>;
  const report = reports.find((r) => r.audit.auditId === id);
  if (!report) return <EmptyState title="Report not found in this browser" action={<Link href="/audit/new" className="ui-btn btn btn-primary">Run an audit</Link>}>Live demo reports are saved in the browser where you run them. Use that browser, or start a fresh audit.</EmptyState>;
  const warning = publicStorageWarning();
  return <>
    {warning ? <div className="mb-6"><Banner tone="warn" title="Report storage">{warning}</Banner></div> : null}
    {!TERMINAL.includes(report.audit.status) && !print ? <LiveAudit initial={report.audit} publicReport={report} /> : <>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={print ? `/audit/${id}` : "/history"} className="text-sm text-muted underline">← {print ? "Interactive report" : "All audits"}</Link>
        {print ? <PrintButton /> : <ReportActions audit={report.audit} publicDemo reportHref={`/audit/${id}/report`} />}
      </div>
      <ReportView report={report} print={print} />
    </>}
  </>;
}

export function PublicHistory() {
  const reports = usePublicReports();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const audits = (reports || []).map((r) => r.audit).filter((a) =>
    (!q || `${a.label || ""} ${a.targetUrl} ${a.queries.map((x) => x.text).join(" ")}`.toLowerCase().includes(q.toLowerCase())) &&
    (!status || a.status === status) && (!from || a.createdAt.slice(0, 10) >= from) && (!to || a.createdAt.slice(0, 10) <= to));
  if (sort === "oldest") audits.reverse();
  return <>
    <p className="eyebrow">Saved audits</p><h1 className="t-display-lg mt-1">History</h1>
    <p className="mt-2 text-sm text-muted">Your latest 20 reports are saved in this browser. Export a report to keep or share it. Keep the tab open while an audit runs.</p>
    <form onSubmit={(e) => e.preventDefault()} role="search" aria-label="Filter audits" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
      <div><label htmlFor="q" className="eyebrow">URL or query</label><input id="q" value={q} onChange={(e) => setQ(e.target.value)} className="ui-input input mt-1" placeholder="search…" /></div>
      <div><label htmlFor="status" className="eyebrow">Status</label><select id="status" value={status} onChange={(e) => setStatus(e.target.value)} className="ui-select input mt-1"><option value="">Any</option>{["completed", "partial", "failed", "cancelled", "running", "queued"].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
      <div><label htmlFor="from" className="eyebrow">From</label><input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ui-input input mt-1" /></div>
      <div><label htmlFor="to" className="eyebrow">To</label><input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ui-input input mt-1" /></div>
      <div><label htmlFor="sort" className="eyebrow">Sort</label><select id="sort" value={sort} onChange={(e) => setSort(e.target.value)} className="ui-select input mt-1"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></div>
      <div className="flex items-end"><button type="button" className="ui-btn btn btn-outline" onClick={() => { setQ(""); setStatus(""); setFrom(""); setTo(""); }}>Clear</button></div>
    </form>
    <div className="mt-6">{!reports ? <p role="status">Opening history…</p> : !audits.length ? <EmptyState title={reports.length ? "No audits match these filters" : "No audits yet"} action={<Link href="/audit/new" className="ui-btn btn btn-primary">Run an audit</Link>}>Run a live audit to save its evidence here.</EmptyState> :
      <ul className="ui-card card divide-y divide-hairline">{audits.map((a) => <li key={a.auditId}><Link href={`/audit/${a.auditId}`} className="flex flex-col gap-2 p-4 hover:bg-[#fafafa] sm:flex-row sm:items-center sm:justify-between">
        <span className="min-w-0"><span className="block truncate font-medium">{a.label || a.targetUrl}</span><span className="block truncate text-sm text-muted">{a.queries[0]?.text || "fetch-only"}</span></span>
        <span className="flex shrink-0 flex-wrap items-center gap-3 text-sm text-muted"><span>{a.summary?.findingsCount ?? 0} findings</span><span>{fmtDate(a.createdAt)}</span><AuditStatusBadge s={a.status} /></span>
      </Link></li>)}</ul>}
    </div>
  </>;
}
