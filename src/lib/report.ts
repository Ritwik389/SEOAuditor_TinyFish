import type { AgentPayload, AgentRunPayload, AuditDoc, EvidenceRecord, BrowserPayload, FetchPayload, RobotsPayload, SearchPayload, SitemapPayload } from "./types";

/** One-line, user-readable description of an evidence record (used in the live timeline). */
export function evidenceBrief(e: EvidenceRecord): string {
  switch (e.sourceType) {
    case "search": {
      const p = e.normalizedPayload as SearchPayload;
      return `${p.results.length} results · ${p.match ? `target at #${p.match.position}` : "target not in checked results"}`;
    }
    case "fetch": {
      const p = e.normalizedPayload as FetchPayload;
      return p.error ? `Failed: ${p.error.code}` : `${p.textLength.toLocaleString("en-US")} chars · title: ${p.title ?? "none"}`;
    }
    case "browser": {
      const p = e.normalizedPayload as BrowserPayload;
      return `${p.visibleTextLength.toLocaleString("en-US")} rendered chars · ${p.headings.length} headings · ${p.missingFromFetch.length} missing from Fetch`;
    }
    case "agent": {
      const p = e.normalizedPayload as AgentPayload;
      return `${p.interactions.length} interactions · ${p.missingFromFetch.length} content gaps · ${p.blockers.length} blockers observed`;
    }
    case "agent_run": {
      const p = e.normalizedPayload as AgentRunPayload;
      return `Run ${p.runId} · ${p.status}${p.steps === null ? "" : ` · ${p.steps} steps`}`;
    }
    case "robots": {
      const p = e.normalizedPayload as RobotsPayload;
      return p.error ? `Unreachable: ${p.error}` : `HTTP ${p.status}${p.genericDisallowsPath ? " · disallows this URL" : ""}`;
    }
    case "sitemap": {
      const p = e.normalizedPayload as SitemapPayload;
      return p.error ? `Unreachable: ${p.error}` : `HTTP ${p.status}${p.urlCount != null ? ` · ${p.urlCount} URLs` : ""}`;
    }
  }
}

export function publicAudit(a: AuditDoc) {
  return a; // AuditDoc contains no secrets by construction; kept as a single choke point.
}
