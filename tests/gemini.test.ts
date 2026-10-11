import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GeminiProvider, ProviderError, testGemini } from "@/lib/gemini/provider";
import { defaultMockState, startMock, type Mock } from "./mock-servers";

let mock: Mock;
beforeAll(async () => {
  mock = await startMock();
  process.env.GEMINI_BASE_URL = `${mock.base}/gemini`;
});
afterAll(() => mock.close());
beforeEach(() => {
  Object.assign(mock.state, defaultMockState());
  mock.state.requests.length = 0;
});

describe("Gemini provider", () => {
  it("sends the key as a header (never in the URL) and requests JSON output", async () => {
    mock.state.gemini.text = '{"ok":true}';
    const text = await new GeminiProvider("AIza-secret-key-123", "gemini-3.8-flash").generateJson({ system: "s", user: "u" });
    expect(text).toBe('{"ok":true}');
    const r = mock.state.requests[0]!;
    expect(r.headers["x-goog-api-key"]).toBe("AIza-secret-key-123");
    expect(r.path).not.toContain("AIza");
    expect(r.path).toContain("models/gemini-3.8-flash:generateContent");
    expect(JSON.parse(r.body).generationConfig.responseMimeType).toBe("application/json");
  });
  it("classifies quota and auth failures with clear messages", async () => {
    mock.state.gemini.status = 429;
    await expect(new GeminiProvider("k", "m").generateJson({ system: "s", user: "u" })).rejects.toMatchObject({ code: "quota" });
    mock.state.gemini.status = 403;
    await expect(new GeminiProvider("k", "m").generateJson({ system: "s", user: "u" })).rejects.toMatchObject({ code: "auth" });
    mock.state.gemini.status = 404;
    const e = await new GeminiProvider("k", "m").generateJson({ system: "s", user: "u" }).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe("model");
  });
  it("connection test verifies model access and generation in two real requests", async () => {
    mock.state.gemini.text = '{"ok":true}';
    const r = await testGemini("k", "gemini-3.8-flash");
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.step)).toEqual(["model access", "generation"]);
    expect(mock.state.requests).toHaveLength(2);
  });
  it("connection test reports a quota failure at the generation step", async () => {
    mock.state.gemini.status = 429;
    const r = await testGemini("k", "m");
    expect(r.ok).toBe(false);
    expect(r.steps.at(-1)).toMatchObject({ step: "generation", ok: false });
    expect(r.message).toMatch(/quota/i);
  });
});
