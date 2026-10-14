"use client";

import { useEffect, useState } from "react";
import type { CreateAuditInput } from "./audit/create";
import type { ReportData } from "./types";
import { TERMINAL } from "./types";

const PREFIX = "seoauditor:report:";
const CHANGE = "seoauditor:reports-changed";
const ACTIVE = "seoauditor:active";
const reports = new Map<string, ReportData>();
const active = new Map<string, AbortController>();
let loaded = false;
let storageWarning = "";

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const report = JSON.parse(localStorage.getItem(key)!);
        if (report.audit?.auditId === key.slice(PREFIX.length) && Array.isArray(report.evidence) && Array.isArray(report.findings)) reports.set(report.audit.auditId, report);
      } catch { /* Ignore a damaged local entry. */ }
    }
    // A full reload closes this tab's streaming request. Reopening another tab
    // does not interrupt the tab that owns the run (sessionStorage is per tab).
    const interrupted: string[] = JSON.parse(sessionStorage.getItem(ACTIVE) || "[]");
    sessionStorage.removeItem(ACTIVE);
    for (const id of interrupted) {
      const report = reports.get(id);
      if (!report || active.has(id) || TERMINAL.includes(report.audit.status)) continue;
      const at = new Date().toISOString();
      const stopped: ReportData = { ...report, audit: { ...report.audit, status: "failed", completedAt: at, updatedAt: at,
        errorSummary: "The tab was reloaded before the audit finished. Collected evidence is preserved. Retry to run a fresh audit.",
        stages: report.audit.stages.map((s) => ["running", "queued"].includes(s.status) ? { ...s, status: "skipped", message: "Connection closed before this stage finished." } : s),
      } };
      reports.set(id, stopped);
      localStorage.setItem(PREFIX + id, JSON.stringify(stopped));
    }
  } catch { storageWarning = "Browser storage is unavailable. Export reports before closing this tab."; }
}
function notify() { window.dispatchEvent(new Event(CHANGE)); }
function saveActive() { try { sessionStorage.setItem(ACTIVE, JSON.stringify([...active.keys()])); } catch { /* optional recovery marker */ } }
function save(report: ReportData) {
  load();
  reports.set(report.audit.auditId, report);
  const sorted = [...reports.values()].sort((a, b) => b.audit.createdAt.localeCompare(a.audit.createdAt));
  for (const old of sorted.slice(20)) {
    if (active.has(old.audit.auditId)) continue;
    reports.delete(old.audit.auditId);
    try { localStorage.removeItem(PREFIX + old.audit.auditId); } catch { /* unavailable */ }
  }
  try { localStorage.setItem(PREFIX + report.audit.auditId, JSON.stringify(report)); }
  catch { storageWarning = "Browser storage is full or unavailable. This report remains open in this tab; export it to keep a copy."; }
  notify();
}
export function getPublicReport(id: string) { load(); return reports.get(id) ?? null; }
export function listPublicReports() { load(); return [...reports.values()].sort((a, b) => b.audit.createdAt.localeCompare(a.audit.createdAt)); }
export function publicStorageWarning() { return storageWarning; }
export function deletePublicReport(id: string) {
  active.get(id)?.abort();
  reports.delete(id);
  try { localStorage.removeItem(PREFIX + id); } catch { /* unavailable */ }
  notify();
}
function stopReport(id: string, cancelled: boolean, message: string) {
  const report = getPublicReport(id);
  if (!report || TERMINAL.includes(report.audit.status)) return;
  const at = new Date().toISOString();
  save({ ...report, audit: { ...report.audit, status: cancelled ? "cancelled" : "failed", cancelRequested: cancelled, completedAt: at, updatedAt: at, errorSummary: message,
    stages: report.audit.stages.map((s) => ["running", "queued"].includes(s.status) ? { ...s, status: "skipped", message: "Stopped before this stage finished." } : s),
  } });
}
export function cancelPublicAudit(id: string) {
  active.get(id)?.abort();
  stopReport(id, true, "Audit cancelled. Collected evidence is preserved; retry to run it again.");
}

/** Resolves when the first real server snapshot arrives. The reader survives
 * client-side navigation and saves each subsequent snapshot in this browser. */
export function startPublicAudit(input: CreateAuditInput): Promise<string> {
  load();
  const ctl = new AbortController();
  let id: string | undefined;
  return new Promise((resolve, reject) => {
    void (async () => {
      const response = await fetch("/api/public-audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: ctl.signal });
      if (!response.ok) {
        const j = await response.json().catch(() => null);
        throw new Error(j?.error?.message || "Could not start the audit.");
      }
      if (!response.body) throw new Error("The server did not return an audit stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      const accept = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === "error") throw new Error(event.message);
        if (!event.report) return;
        const report = event.report as ReportData;
        if (!id) { id = report.audit.auditId; active.set(id, ctl); saveActive(); }
        save(report);
        resolve(id);
      };
      while (true) {
        const chunk = await reader.read();
        pending += decoder.decode(chunk.value, { stream: !chunk.done });
        let end;
        while ((end = pending.indexOf("\n")) >= 0) { accept(pending.slice(0, end)); pending = pending.slice(end + 1); }
        if (chunk.done) { if (pending.trim()) accept(pending); break; }
      }
      if (!id) throw new Error("No audit was received from the server.");
      stopReport(id, false, "The connection closed before the audit finished. Retry to collect fresh evidence.");
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "The live audit connection failed.";
      if (id) stopReport(id, ctl.signal.aborted, ctl.signal.aborted ? "Audit cancelled. Collected evidence is preserved." : message);
      else reject(new Error(message));
    }).finally(() => { if (id) active.delete(id); saveActive(); });
  });
}

export function usePublicReports() {
  const [state, setState] = useState<ReportData[] | null>(null);
  useEffect(() => {
    const update = () => setState(listPublicReports());
    const storage = () => { loaded = false; reports.clear(); update(); };
    update();
    window.addEventListener(CHANGE, update);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(CHANGE, update); window.removeEventListener("storage", storage); };
  }, []);
  return state;
}
