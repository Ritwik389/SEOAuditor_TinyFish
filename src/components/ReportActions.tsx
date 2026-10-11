"use client";

import { Printer, RotateCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AuditDoc } from "@/lib/types";

export function ReportActions({ audit, reportHref }: { audit: AuditDoc; reportHref?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function post(path: string, label: string) {
    setBusy(label);
    setErr("");
    const r = await fetch(path, { method: "POST" });
    const j = await r.json().catch(() => null);
    setBusy("");
    if (!r.ok) return setErr(j?.error?.message ?? "Request failed.");
    if (j?.auditId) router.push(`/audit/${j.auditId}`);
  }

  async function remove() {
    if (!confirm("Delete this audit and all its evidence? This cannot be undone.")) return;
    setBusy("delete");
    const r = await fetch(`/api/audits/${audit.auditId}`, { method: "DELETE" });
    if (r.ok) return router.push("/history");
    setBusy("");
    setErr((await r.json().catch(() => null))?.error?.message ?? "Could not delete.");
  }

  const failed = audit.status === "failed" || audit.status === "partial" || audit.status === "waiting_config" || audit.status === "cancelled";
  return (
    <div className="no-print">
      <div className="flex flex-wrap gap-2">
        {reportHref ? <Link href={reportHref} className="btn btn-outline btn-sm"><Printer size={14} aria-hidden /> Printable report</Link> : null}
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
