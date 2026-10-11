import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TinyFishError, tfRequest } from "@/lib/tinyfish/client";
import { tfSearch } from "@/lib/tinyfish/search";
import { tfFetch } from "@/lib/tinyfish/fetch";
import { createSession, endSession } from "@/lib/tinyfish/browser";
import { testTinyFishOperation } from "@/lib/tinyfish/test";
import { defaultMockState, startMock, type Mock } from "./mock-servers";

let mock: Mock;
beforeAll(async () => {
  mock = await startMock();
  process.env.TINYFISH_SEARCH_URL = `${mock.base}/search`;
  process.env.TINYFISH_FETCH_URL = `${mock.base}/fetch`;
  process.env.TINYFISH_BROWSER_URL = `${mock.base}/browser`;
});
afterAll(() => mock.close());
beforeEach(() => {
  Object.assign(mock.state, defaultMockState());
  mock.state.requests.length = 0;
});

describe("TinyFish Search adapter", () => {
  it("sends GET with X-API-Key header and documented params, and normalizes results", async () => {
    const r = await tfSearch("test-key", { query: "product analytics pricing", location: "US", language: "en" });
    const req = mock.state.requests[0]!;
    expect(req.method).toBe("GET");
    expect(req.headers["x-api-key"]).toBe("test-key");
    const u = new URL(req.path, "http://x");
    expect(u.searchParams.get("query")).toBe("product analytics pricing");
    expect(u.searchParams.get("location")).toBe("US");
    expect(u.searchParams.get("language")).toBe("en");
    expect(r.results).toHaveLength(3);
    expect(r.results[1]).toMatchObject({ position: 2, title: "Acme Metrics pricing", siteName: "mock" });
    expect(r.totalResults).toBe(3);
    expect(r.requestId).toBe("req-mock");
  });
  it("never puts the key in the URL", async () => {
    await tfSearch("test-key", { query: "x" });
    expect(mock.state.requests[0]!.path).not.toMatch(/test-key/);
  });
});

describe("TinyFish Fetch adapter", () => {
  it("POSTs the documented body and normalizes the result", async () => {
    const target = `${mock.base}/pricing`;
    const r = await tfFetch("test-key", { url: target, maxChars: 500 });
    const req = mock.state.requests[0]!;
    expect(req.method).toBe("POST");
    expect(JSON.parse(req.body)).toMatchObject({ urls: [target], format: "markdown", links: true, page_metadata: true, ttl: 0 });
    expect(r.payload.title).toMatch(/Acme Metrics/);
    expect(r.payload.text.length).toBe(500);
    expect(r.payload.textTruncated).toBe(true);
    expect(r.payload.textLength).toBeGreaterThan(500);
    expect(r.payload.pageMetadata?.canonical).toBe(target);
    expect(r.payload.links).toHaveLength(3);
    expect(r.payload.error).toBeUndefined();
  });
  it("turns a per-URL error into a normalized error payload (not an exception)", async () => {
    mock.state.fetch.body = { results: [], errors: [{ url: "x", error: "bot_blocked" }] };
    const r = await tfFetch("test-key", { url: "https://x.com/", maxChars: 1000 });
    expect(r.payload.error).toMatchObject({ code: "bot_blocked" });
    expect(r.payload.text).toBe("");
  });
  it("does not invent HTTP status or structured data", async () => {
    const r = await tfFetch("test-key", { url: `${mock.base}/pricing`, maxChars: 1000 });
    expect(Object.keys(r.payload)).not.toContain("httpStatus");
    expect(Object.keys(r.payload)).not.toContain("jsonLd");
  });
});

describe("TinyFish Browser session adapter", () => {
  it("creates a session via POST and terminates it via DELETE /{id}", async () => {
    const { session } = await createSession("test-key", { url: "https://example.com" });
    expect(session.session_id).toBe("br-test-1");
    expect(JSON.parse(mock.state.requests[0]!.body)).toMatchObject({ url: "https://example.com" });
    expect(await endSession("test-key", session.session_id)).toBe(true);
    expect(mock.state.requests[1]).toMatchObject({ method: "DELETE", path: "/browser/br-test-1" });
  });
});

describe("retry behaviour", () => {
  it("retries a 503 once with Retry-After and succeeds without duplicating on success", async () => {
    mock.state.search.failTimes = 1;
    const attempts: number[] = [];
    const r = await tfSearch("test-key", { query: "x", onAttempt: (n) => attempts.push(n) });
    expect(r.results).toHaveLength(3);
    expect(attempts).toEqual([1, 2]);
    expect(mock.state.requests).toHaveLength(2);
  });
  it("gives up after the retry budget on persistent 503", async () => {
    mock.state.search.failTimes = 99;
    await expect(tfRequest({ url: `${mock.base}/search?query=x`, method: "GET", apiKey: "test-key", timeoutMs: 5000, retries: 2 })).rejects.toMatchObject({ code: "SERVICE_BUSY" });
    expect(mock.state.requests).toHaveLength(3);
  });
  it("does not retry auth failures", async () => {
    const e = await tfSearch("wrong-key", { query: "x" }).catch((x) => x);
    expect(e).toBeInstanceOf(TinyFishError);
    expect(e).toMatchObject({ status: 401, code: "INVALID_API_KEY", retryable: false });
    expect(mock.state.requests).toHaveLength(1);
  });
  it("does not retry 402 insufficient credits", async () => {
    mock.state.search.status = 402;
    const e = await tfSearch("test-key", { query: "x" }).catch((x) => x);
    expect(e.code).toBe("INSUFFICIENT_CREDITS");
    expect(mock.state.requests).toHaveLength(1);
  });
  it("aborts promptly when the signal fires", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(tfSearch("test-key", { query: "x", signal: ctl.signal })).rejects.toThrow();
  });
});

describe("connection tests exercise real requests per operation", () => {
  it("search and fetch pass independently of browser", async () => {
    mock.state.browser = { status: 403, body: {} };
    const s = await testTinyFishOperation("test-key", "search");
    const f = await testTinyFishOperation("test-key", "fetch");
    const b = await testTinyFishOperation("test-key", "browser");
    expect([s.ok, f.ok, b.ok]).toEqual([true, true, false]);
    expect(b.message).toMatch(/not enabled|FORBIDDEN/i);
  });
  it("a bad key fails every operation (auth success is never assumed)", async () => {
    const r = await testTinyFishOperation("nope", "search");
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(401);
  });
});
