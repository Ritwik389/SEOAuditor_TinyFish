import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuditInsights } from "../src/components/report/AuditInsights";
import { getDemoReport } from "../src/lib/demo/reports";
import type { AgentPayload, EvidenceRecord, FetchPayload, ReportData, SearchPayload } from "../src/lib/types";

const CREATE_ENDPOINT = "POST agent.tinyfish.ai/v1/automation/run-async";
const STATUS_ENDPOINT = "GET agent.tinyfish.ai/v1/runs/{id}";
const CANCEL_ENDPOINT = "POST agent.tinyfish.ai/v1/runs/{id}/cancel";

function report(): ReportData {
  return structuredClone(getDemoReport("saas-pricing")!);
}

function record(data: ReportData, id: string, kind: "agent" | "agent_run", endpoint: string, payload: unknown): EvidenceRecord {
  return { ...data.evidence[0]!, evidenceId: id, sourceType: kind, endpoint, label: kind, normalizedPayload: payload };
}

function addAgent(data: ReportData) {
  const payload: AgentPayload = {
    requestedUrl: data.audit.targetUrl, finalUrl: data.audit.targetUrl, title: "Plans",
    objective: "Check the retention FAQ", observationsOnly: true,
    visibleTextSample: "Team plans retain analytics events for 90 days.",
    interactions: [{ control: "Retention FAQ", action: "Expanded", result: "Answer visible" }],
    answers: [{ question: "How long are events retained?", answer: "90 days", quote: "Team plans retain analytics events for 90 days." }],
    missingFromFetch: ["Team plans retain analytics events for 90 days."], blockers: [],
  };
  data.evidence.push(record(data, "ev_agent_1", "agent", `${CREATE_ENDPOINT} + ${STATUS_ENDPOINT}`, payload));
}

function text(data: ReportData): string {
  return renderToStaticMarkup(createElement(AuditInsights, { report: data })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("report evidence claims", () => {
  it.each(["SUBMITTED", "PENDING"])("does not count a %s create acknowledgment as a separate status endpoint", (status) => {
    const data = report();
    data.evidence.push(record(data, "ev_agent_run_1", "agent_run", CREATE_ENDPOINT, { runId: "run-1", status, steps: null, error: null }));
    const content = text(data);
    expect(content).toContain("3 endpoint types with evidence");
    expect(content).toContain("Creation acknowledgment only: no separate run-status evidence was collected.");
    expect(content).not.toContain(STATUS_ENDPOINT);
  });

  it("counts creation once and attributes run-status evidence to the GET endpoint", () => {
    const data = report();
    data.evidence.push(record(data, "ev_agent_run_1", "agent_run", CREATE_ENDPOINT, { runId: "run-1", status: "SUBMITTED", steps: null, error: null }));
    data.evidence.push(record(data, "ev_agent_run_2", "agent_run", STATUS_ENDPOINT, { runId: "run-1", status: "COMPLETED", steps: 3, error: null }));
    addAgent(data);
    const content = text(data);
    expect(content).toContain("4 endpoint types with evidence");
    expect(content).toContain(`Agent run status ${STATUS_ENDPOINT}`);
    expect(content).not.toContain(`Agent run status ${CREATE_ENDPOINT}`);
  });

  it("reports cancellation as cleanup rather than inventing a status poll", () => {
    const data = report();
    data.evidence.push(record(data, "ev_agent_run_1", "agent_run", CREATE_ENDPOINT, { runId: "run-1", status: "SUBMITTED", steps: null, error: null }));
    data.evidence.push(record(data, "ev_agent_run_2", "agent_run", CANCEL_ENDPOINT, { runId: "run-1", status: "CANCELLED", steps: null, error: null }));
    const content = text(data);
    expect(content).toContain(`Agent cleanup ${CANCEL_ENDPOINT}`);
    expect(content).toContain("Creation acknowledgment only: no separate run-status evidence was collected.");
    expect(content).not.toContain(STATUS_ENDPOINT);
  });

  it("places an incomplete search sample with zero matches in the undiscovered column", () => {
    const data = report();
    (data.evidence.find((e) => e.sourceType === "search")!.normalizedPayload as SearchPayload).match = null;
    data.audit.queries.push({ text: "a second query with no collected search evidence", source: "user" });
    expect(text(data)).toContain("Observed here Readable, missing from search");
    expect(text(data)).not.toContain("Observed here Readable and discovered");
  });

  it.each(["failed", "truncated", "empty"])("keeps Agent answers but marks Fetch comparison unmeasured for %s extraction", (mode) => {
    const data = report();
    const fetched = data.evidence.find((e) => e.sourceType === "fetch")!.normalizedPayload as FetchPayload;
    if (mode === "failed") fetched.error = { code: "FETCH_FAILED", message: "Unavailable" };
    if (mode === "truncated") fetched.textTruncated = true;
    if (mode === "empty") fetched.text = "";
    addAgent(data);
    const content = text(data);
    expect(content).toContain("Fetch comparison was not measured");
    expect(content).toContain("How long are events retained?");
    expect(content).not.toContain("Agent reported content absent from Fetch");
    expect(content).not.toContain("The Agent reported no additional content absent from Fetch.");
  });
});
