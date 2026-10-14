"use client";

import { Download, Printer, RotateCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AuditDoc, ReportData } from "@/lib/types";
import { buildAuditInsights } from "@/lib/analysis/insights";
import { deletePublicReport, getPublicReport, startPublicAudit } from "@/lib/public-audits";

export function ReportActions({ audit, reportHref, publicDemo = false }: { audit: AuditDoc; reportHref?: string; publicDemo?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function post(path: string, label: string) {
    setBusy(label);
    setErr("");
    if (publicDemo) {
      try {
        const id = await startPublicAudit({ url: audit.targetUrl, label: audit.label, queries: audit.queries, ...audit.settings });
        router.push(`/audit/${id}`);
      } catch (error) { setErr(error instanceof Error ? error.message : "Could not retry the audit."); }
      finally { setBusy(""); }
      return;
    }
    const r = await fetch(path, { method: "POST" });
    const j = await r.json().catch(() => null);
    setBusy("");
    if (!r.ok) return setErr(j?.error?.message ?? "Request failed.");
    if (j?.auditId) router.push(`/audit/${j.auditId}`);
  }

  async function remove() {
    if (!confirm("Delete this audit and all its evidence? This cannot be undone.")) return;
    setBusy("delete");
    if (publicDemo) { deletePublicReport(audit.auditId); router.push("/history"); return; }
    const r = await fetch(`/api/audits/${audit.auditId}`, { method: "DELETE" });
    if (r.ok) return router.push("/history");
    setBusy("");
    setErr((await r.json().catch(() => null))?.error?.message ?? "Could not delete.");
  }

  async function exportEvidence() {
    setBusy("export");
    setErr("");
    try {
      let report;
      if (publicDemo) {
        report = getPublicReport(audit.auditId);
        if (!report) throw new Error("This report is no longer saved in this browser.");
      } else {
        const response = await fetch(`/api/audits/${audit.auditId}/report`);
        report = await response.json();
        if (!response.ok) throw new Error(report?.error?.message ?? "Could not export the report.");
      }
      const payload = report as ReportData;
      const file = new Blob([JSON.stringify({ ...payload, insights: buildAuditInsights(payload) }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = `seo-auditor-${audit.auditId}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Could not export the report.");
    } finally {
      setBusy("");
    }
  }

  const failed = audit.status === "failed" || audit.status === "partial" || audit.status === "waiting_config" || audit.status === "cancelled";
  return (
    <div className="no-print">
      <div className="flex flex-wrap gap-2">
        {reportHref ? <Link href={reportHref} className="btn btn-outline btn-sm"><Printer size={14} aria-hidden /> Printable report</Link> : null}
        <button type="button" className="ui-btn btn btn-outline btn-sm" disabled={!!busy} onClick={exportEvidence}><Download size={14} aria-hidden /> {busy === "export" ? "Exporting…" : "Export evidence"}</button>
        {failed ? <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => post(`/api/audits/${audit.auditId}/retry`, "retry")}><RotateCw size={14} aria-hidden /> {busy === "retry" ? "Starting…" : "Retry audit"}</button> : null}
        <Link href={`/audit/new?url=${encodeURIComponent(audit.targetUrl)}${audit.queries[0] ? `&query=${encodeURIComponent(audit.queries[0].text)}` : ""}`} className="btn btn-outline btn-sm">New audit, same URL</Link>
        <button className="btn btn-danger btn-sm" disabled={!!busy} onClick={remove}><Trash2 size={14} aria-hidden /> Delete</button>
      </div>
      {err ? <p role="alert" className="mt-2 text-sm text-crit">{err}</p> : null}
    </div>
  );
}

export function PrintButton() {
  return <button onClick={() => window.print()} className="btn btn-primary btn-sm no-print"><Printer size={14} aria-hidden /> Print / Save as PDF</button>;
}
