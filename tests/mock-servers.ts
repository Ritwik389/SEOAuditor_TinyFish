import http from "node:http";
import type { AddressInfo } from "node:net";

// Local stand-ins for TinyFish and Gemini, used by integration and e2e tests only.
// Shapes follow https://agent.tinyfish.ai/v1/openapi/{search,fetch,browser}.

export interface MockState {
  apiKey: string;
  search: { status: number; body: unknown; failTimes: number; delayMs?: number };
  fetch: { status: number; body: unknown; failTimes: number; delayMs?: number };
  browser: { status: number; body: unknown };
  agent: { status: number; runStatus: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"; result: unknown; numOfSteps: number; error?: string; delayMs?: number };
  gemini: { status: number; text: string; auto?: boolean };
  requests: { method: string; path: string; headers: http.IncomingHttpHeaders; body: string }[];
}

export const defaultMockState = (): MockState => ({
  apiKey: "test-key",
  search: {
    status: 200,
    failTimes: 0,
    body: {
      query: "product analytics pricing",
      page: 0,
      total_results: 3,
      results: [
        { position: 1, site_name: "mixpanel.com", title: "Mixpanel pricing", snippet: "Mixpanel pricing for product analytics with event based billing.", url: "https://mixpanel.com/pricing" },
        { position: 2, site_name: "mock", title: "Acme Metrics pricing", snippet: "Plans start at $29/mo for product analytics teams.", url: "__TARGET__" },
        { position: 3, site_name: "amplitude.com", title: "Amplitude pricing", snippet: "Amplitude pricing with event based billing for product analytics.", url: "https://amplitude.com/pricing" },
      ],
    },
  },
  fetch: {
    status: 200,
    failTimes: 0,
    body: {
      results: [
        {
          url: "__TARGET__",
          final_url: "__TARGET__",
          title: "Acme Metrics pricing — product analytics plans",
          description: "Compare Acme Metrics plans for product analytics: Starter from $29/mo and Team from $99/mo. Start a 14-day free trial, no card required.",
          language: "en",
          format: "markdown",
          text: "# Acme Metrics pricing\n\nProduct analytics software for SaaS teams. Plans start at $29/mo.\n\n## Starter\n\nStarter costs $29/mo and includes 10,000 events.\n\n## Team\n\nTeam costs $99/mo with unlimited dashboards.\n\n" + "Lorem ipsum dolor sit amet consectetur. ".repeat(30),
          author: null,
          published_date: null,
          links: ["__ORIGIN__/", "__ORIGIN__/docs", "https://twitter.com/acme"],
          page_metadata: { canonical: "__TARGET__", robots: "index, follow", og: { title: "Acme", description: "x" } },
          latency_ms: 120,
        },
      ],
      errors: [],
    },
  },
  browser: { status: 201, body: { session_id: "br-test-1", cdp_url: "wss://example.invalid/cdp", base_url: "https://example.invalid" } },
  agent: { status: 200, runStatus: "COMPLETED", numOfSteps: 3, result: {
    finalUrl: "__TARGET__", title: "Acme Metrics pricing",
    visibleTextSample: "Acme Metrics pricing. Starter costs $29/mo and includes 10,000 events. Team costs $99/mo with unlimited dashboards. Team plans retain analytics events for 90 days.",
    interactions: [{ control: "Team data retention FAQ", action: "Expanded FAQ accordion", result: "Retention period became visible" }],
    answers: [{ question: "How long does Team retain events?", answer: "Team plans retain analytics events for 90 days.", quote: "Team plans retain analytics events for 90 days." }], blockers: [],
  } },
  gemini: { status: 200, text: "{}" },
  requests: [],
});

export interface Mock {
  port: number;
  base: string;
  state: MockState;
  /** Plain-text routes served as the "target website" (robots.txt, sitemap.xml, pages). */
  site: Map<string, { status?: number; type?: string; body: string }>;
  close(): Promise<void>;
}

const subst = (v: unknown, target: string, origin: string) => JSON.parse(JSON.stringify(v).replaceAll("__TARGET__", target).replaceAll("__ORIGIN__", origin));

export async function startMock(port = 0): Promise<Mock> {
  const state = defaultMockState();
  const site: Mock["site"] = new Map();
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString();
    const url = new URL(req.url ?? "/", "http://x");
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const target = `${origin}/pricing`;
    const send = (status: number, data: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", "x-request-id": "req-mock", ...headers });
      res.end(typeof data === "string" ? data : JSON.stringify(data));
    };
    const err = (status: number, code: string, message: string, headers: Record<string, string> = {}) => send(status, { error: { code, message } }, headers);

    if (url.pathname.startsWith("/search") || url.pathname.startsWith("/fetch") || url.pathname.startsWith("/browser") || url.pathname.startsWith("/agent/")) {
      state.requests.push({ method: req.method ?? "", path: url.pathname + url.search, headers: req.headers, body });
      if (req.headers["x-api-key"] !== state.apiKey) return err(401, "INVALID_API_KEY", "Invalid or expired API key");
    }
    if (url.pathname === "/search") {
      const s = state.search;
      if (s.failTimes > 0) {
        s.failTimes--;
        return err(503, "SERVICE_BUSY", "busy", { "retry-after": "0" });
      }
      return s.status === 200 ? send(200, subst(s.body, target, origin)) : err(s.status, s.status === 402 ? "INSUFFICIENT_CREDITS" : "INTERNAL_ERROR", "search failed");
    }
    if (url.pathname === "/fetch") {
      const f = state.fetch;
      if (f.delayMs) await new Promise((r) => setTimeout(r, f.delayMs));
      if (f.failTimes > 0) {
        f.failTimes--;
        return err(503, "SERVICE_BUSY", "busy", { "retry-after": "0" });
      }
      return f.status === 200 ? send(200, subst(f.body, target, origin)) : err(f.status, "INTERNAL_ERROR", "fetch failed");
    }
    if (url.pathname === "/browser" && req.method === "POST") return state.browser.status === 201 ? send(201, state.browser.body) : err(state.browser.status, state.browser.status === 403 ? "FORBIDDEN" : "INTERNAL_ERROR", "browser unavailable");
    if (url.pathname.startsWith("/browser/") && req.method === "DELETE") {
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === "/agent/v1/automation/run-async" && req.method === "POST") {
      if (state.agent.delayMs) await new Promise((r) => setTimeout(r, state.agent.delayMs));
      return state.agent.status === 200 ? send(200, { run_id: "agent-test-1", status: "PENDING" }) : err(state.agent.status, "INTERNAL_ERROR", "agent unavailable");
    }
    if (url.pathname === "/agent/v1/runs/agent-test-1" && req.method === "GET") return send(200, { status: state.agent.runStatus, result: subst(state.agent.result, target, origin), num_of_steps: state.agent.numOfSteps, error: state.agent.error });
    if (url.pathname === "/agent/v1/runs/agent-test-1/cancel" && req.method === "POST") return send(200, { status: "CANCELLED" });
    if (url.pathname.includes(":generateContent") || url.pathname.startsWith("/gemini/")) {
      state.requests.push({ method: req.method ?? "", path: url.pathname, headers: req.headers, body });
      if (!req.headers["x-goog-api-key"]) return err(403, "PERMISSION_DENIED", "no key");
      if (url.pathname.endsWith(":generateContent")) {
        if (state.gemini.status !== 200) return err(state.gemini.status, "X", "gemini failure");
        let text = state.gemini.text;
        if (state.gemini.auto) {
          // Demo/e2e responder: answers the two prompt types Sniffsite sends, with quotes that exist in the mock page.
          text = body.includes("single web search query")
            ? JSON.stringify({ query: "product analytics pricing", rationale: "The page lists plans and prices for analytics software." })
            : JSON.stringify({
                gap: { searchCommunicates: "Plans start at $29/mo for product analytics.", pageExplains: "Two priced plans with event quotas.", purposeMatch: "yes", purposeRationale: "The page is a pricing page for product analytics.", snippetOmissions: ["Unlimited dashboards on Team"], evidenceRefs: ["ev_fetch_1", "ev_search_1"] },
                entities: [{ name: "Starter", type: "plan", excerpt: "Starter costs $29/mo and includes 10,000 events", evidenceId: "ev_fetch_1" }],
                findings: [{ title: "Plans do not say who each tier is for", severity: "medium", confidence: "medium", category: "messaging", explanation: "Plans list price and events but no target audience.", whyItMatters: "Buyers self-select by team size.", evidenceRefs: ["ev_fetch_1"], excerpts: [{ evidenceId: "ev_fetch_1", text: "Starter costs $29/mo and includes 10,000 events" }], recommendedAction: "Add an audience line under each plan name.", suggestedImplementation: "Starter: for solo founders and small teams.", expectedOutcome: "Clearer plan selection.", verificationMethod: "Re-run the audit.", verificationStatus: "observed" }],
              });
        }
        return send(200, { candidates: [{ content: { parts: [{ text }] } }] });
      }
      return send(200, { name: "models/test", supportedGenerationMethods: ["generateContent"] });
    }
    const s = site.get(url.pathname);
    if (s) {
      res.writeHead(s.status ?? 200, { "content-type": s.type ?? "text/plain" });
      return res.end(s.body.replaceAll("__ORIGIN__", origin));
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const p = (server.address() as AddressInfo).port;
  return { port: p, base: `http://127.0.0.1:${p}`, state, site, close: () => new Promise((r) => (server.closeAllConnections(), server.close(() => r()))) };
}
