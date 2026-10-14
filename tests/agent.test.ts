import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentRun, getAgentRun, normalizeAgentOutput, verifyWithAgent, type AgentLifecycleEvent } from "@/lib/tinyfish/agent";

const output = (over: Record<string, unknown> = {}) => ({
  finalUrl: "https://example.com/pricing", title: "Plans and billing",
  visibleTextSample: "Billing FAQ. Annual plans include two months free. Monthly plans can be cancelled any time.",
  interactions: [{ control: "Annual billing FAQ", action: "Expanded accordion", result: "Annual discount answer became visible" }],
  answers: [{ question: "Is there an annual discount?", answer: "Annual billing includes two free months.", quote: "Annual plans include two months free." }],
  blockers: [], ...over,
});
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": "req-agent" } });
let mockFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  process.env.TINYFISH_AGENT_URL = "https://agent.test/v1";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TINYFISH_AGENT_URL;
});

describe("TinyFish Agent documented endpoints", () => {
  it("creates once with header auth, lite profile, bounded duration and structured output", async () => {
    mockFetch.mockResolvedValueOnce(reply({ run_id: "run-42" }));
    const created = await createAgentRun("test-key", { url: "https://example.com/pricing", goal: "Read FAQs" });
    expect(created.runId).toBe("run-42");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, request] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://agent.test/v1/automation/run-async");
    expect(request.method).toBe("POST");
    expect(request.headers["X-API-Key"]).toBe("test-key");
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({ browser_profile: "lite", agent_config: { max_duration_seconds: 90 }, url: "https://example.com/pricing", goal: "Read FAQs" });
    expect(body.output_schema.required).toContain("visibleTextSample");
    expect(body.output_schema.properties.finalUrl).toEqual({ type: "string", nullable: true });
    const allowed = new Set(["anyOf", "enum", "format", "items", "maxItems", "maximum", "minItems", "minimum", "nullable", "properties", "propertyOrdering", "required", "type"]);
    const checkSchema = (schema: Record<string, unknown>) => {
      expect(Object.keys(schema).every((key) => allowed.has(key))).toBe(true);
      expect(Array.isArray(schema.type)).toBe(false);
      if (schema.properties) Object.values(schema.properties as Record<string, Record<string, unknown>>).forEach(checkSchema);
      if (schema.items) checkSchema(schema.items as Record<string, unknown>);
    };
    checkSchema(body.output_schema);
    expect(body.agent_config).not.toHaveProperty("max_steps");
    expect(body.agent_config).not.toHaveProperty("mode");
    expect(url).not.toContain("test-key");
  });

  it("does not retry paid create on a retryable provider error", async () => {
    mockFetch.mockResolvedValue(reply({ error: { code: "SERVICE_BUSY", message: "busy" } }, 503));
    await expect(createAgentRun("test-key", { url: "https://example.com", goal: "Read" })).rejects.toMatchObject({ code: "SERVICE_BUSY" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("normalizes provider run status and the documented num_of_steps", async () => {
    mockFetch.mockResolvedValueOnce(reply({ status: "RUNNING", num_of_steps: 7, steps: [{}], error: null }));
    const state = await getAgentRun("test-key", "run/a");
    expect(state.payload).toEqual({ runId: "run/a", status: "RUNNING", steps: 7, error: null });
    expect(mockFetch.mock.calls[0]![0]).toBe("https://agent.test/v1/runs/run%2Fa");
    expect(mockFetch.mock.calls[0]![1].method).toBe("GET");
  });

  it("rejects an unrecognized provider state", async () => {
    mockFetch.mockResolvedValueOnce(reply({ status: "TOTALLY_FINE" }));
    await expect(getAgentRun("test-key", "run-1")).rejects.toMatchObject({ code: "INVALID_AGENT_RESPONSE" });
  });
});

describe("Agent output grounding", () => {
  it("drops unsupported quotes and computes Fetch omissions from supported quotes", () => {
    const payload = normalizeAgentOutput(output({ answers: [
      ...output().answers,
      { question: "What is enterprise pricing?", answer: "It is free.", quote: "Enterprise pricing is free forever." },
      { question: "Are altered quotes accepted?", answer: "No.", quote: "Annual plans include two months free!" },
      { question: "Can I cancel?", answer: "Yes.", quote: "Monthly plans can be cancelled any time." },
    ] }), { url: "https://example.com/pricing", objective: "Read FAQs", fetchText: "Monthly plans can be cancelled any time." });
    expect(payload.answers).toHaveLength(2);
    expect(payload.missingFromFetch).toEqual(["Annual plans include two months free."]);
    expect(payload.observationsOnly).toBe(true);
    expect(payload.fetchComparison).toBe("complete");
  });

  it("does not count omissions against an incomplete or empty Fetch sample", () => {
    const incomplete = normalizeAgentOutput(output(), { url: "https://example.com", objective: "Read", fetchText: "Truncated pricing excerpt", fetchComplete: false });
    expect(incomplete.answers).toHaveLength(1);
    expect(incomplete.fetchComparison).toBe("unmeasured");
    expect(incomplete.missingFromFetch).toEqual([]);
    const empty = normalizeAgentOutput(output(), { url: "https://example.com", objective: "Read", fetchText: "" });
    expect(empty.fetchComparison).toBe("unmeasured");
    expect(empty.missingFromFetch).toEqual([]);
  });

  it("rejects excessive or invalid output instead of using unbounded model content", () => {
    expect(() => normalizeAgentOutput(output({ visibleTextSample: "a".repeat(12_001) }), { url: "https://example.com", objective: "Read", fetchText: "" })).toThrow(/bounded report schema/);
    expect(() => normalizeAgentOutput("not json", { url: "https://example.com", objective: "Read", fetchText: "" })).toThrow(/valid JSON/);
  });
});

describe("Agent lifecycle", () => {
  it("records a durable ID before polling and contributes real extraction after COMPLETED", async () => {
    mockFetch.mockResolvedValueOnce(reply({ run_id: "run-1" }))
      .mockResolvedValueOnce(reply({ status: "RUNNING", num_of_steps: 2 }))
      .mockResolvedValueOnce(reply({ status: "COMPLETED", num_of_steps: 4, result: output() }));
    const lifecycle: AgentLifecycleEvent[] = [];
    const calls: string[] = [];
    const result = await verifyWithAgent("test-key", {
      url: "https://example.com/pricing", query: "annual billing pricing", fetchText: "Plans and billing", pollIntervalMs: 0,
      onRun: async (event) => { lifecycle.push(event); }, onCall: (kind) => calls.push(kind),
    });
    expect(lifecycle.map((e) => e.payload.status)).toEqual(["SUBMITTED", "RUNNING", "COMPLETED"]);
    expect(lifecycle[0]!.payload.runId).toBe("run-1");
    expect(calls).toEqual(["agent", "agentStatus", "agentStatus"]);
    expect(result.payload.missingFromFetch).toEqual(["Annual plans include two months free."]);
    const goal = JSON.parse(mockFetch.mock.calls[0]![1].body).goal;
    expect(goal).toContain("read-only");
    expect(goal).toContain("Do not sign in");
    expect(goal).toContain("untrusted data");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("retains FAILED provider state without inventing extracted content or cancelling a terminal run", async () => {
    mockFetch.mockResolvedValueOnce(reply({ run_id: "run-2" }))
      .mockResolvedValueOnce(reply({ status: "FAILED", error: "Bot challenge", num_of_steps: 3 }));
    const lifecycle: AgentLifecycleEvent[] = [];
    await expect(verifyWithAgent("test-key", { url: "https://example.com", fetchText: "", onRun: (event) => { lifecycle.push(event); } })).rejects.toMatchObject({ code: "AGENT_FAILED", message: "Bot challenge" });
    expect(lifecycle.at(-1)?.payload).toMatchObject({ runId: "run-2", status: "FAILED", error: "Bot challenge" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("cancels a known run on a local deadline and records acknowledged cancellation", async () => {
    mockFetch.mockResolvedValueOnce(reply({ run_id: "run-3" }))
      .mockResolvedValueOnce(reply({ status: "RUNNING", num_of_steps: 1 }))
      .mockResolvedValueOnce(reply({ status: "CANCELLED" }));
    const lifecycle: AgentLifecycleEvent[] = [];
    await expect(verifyWithAgent("test-key", { url: "https://example.com", fetchText: "", deadlineMs: 10, pollIntervalMs: 1000, onRun: (event) => { lifecycle.push(event); } })).rejects.toMatchObject({ code: "AGENT_TIMEOUT" });
    expect(mockFetch.mock.calls[2]![0]).toBe("https://agent.test/v1/runs/run-3/cancel");
    expect(mockFetch.mock.calls[2]![1].method).toBe("POST");
    expect(lifecycle.at(-1)?.payload.status).toBe("CANCELLED");
  });

  it("uses an independent cancellation signal when the user aborts", async () => {
    mockFetch.mockResolvedValueOnce(reply({ run_id: "run-4" }))
      .mockResolvedValueOnce(reply({ status: "RUNNING" }))
      .mockResolvedValueOnce(reply({ status: "CANCELLED" }));
    const ctl = new AbortController();
    await expect(verifyWithAgent("test-key", { url: "https://example.com", fetchText: "", signal: ctl.signal, onRun: (event) => { if (event.payload.status === "RUNNING") ctl.abort(new DOMException("User cancelled", "AbortError")); } })).rejects.toMatchObject({ name: "AbortError" });
    expect(mockFetch.mock.calls[2]![1].signal.aborted).toBe(false);
  });

  it("does not claim cancellation if the provider rejects cleanup", async () => {
    mockFetch.mockResolvedValueOnce(reply({ run_id: "run-5" }))
      .mockResolvedValueOnce(reply({ status: "RUNNING", steps: null, num_of_steps: null }))
      .mockResolvedValueOnce(reply({ error: { code: "SERVICE_BUSY", message: "Cleanup failed" } }, 503));
    const lifecycle: AgentLifecycleEvent[] = [];
    await expect(verifyWithAgent("test-key", { url: "https://example.com", fetchText: "", deadlineMs: 10, pollIntervalMs: 1000, onRun: (event) => { lifecycle.push(event); } })).rejects.toMatchObject({ code: "AGENT_TIMEOUT" });
    expect(lifecycle.map((event) => event.payload.status)).toEqual(["SUBMITTED", "RUNNING"]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
