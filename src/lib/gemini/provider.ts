import { getCredential, getSettings } from "../config";

// Provider abstraction: the audit engine only knows `AnalysisProvider`, so Gemini can be swapped out.
export interface AnalysisProvider {
  id: string;
  model: string;
  /** Returns the raw JSON text the model produced. Callers validate it with Zod. */
  generateJson(p: { system: string; user: string; signal?: AbortSignal }): Promise<string>;
}

export class ProviderError extends Error {
  constructor(message: string, public status: number, public code: "auth" | "quota" | "model" | "network" | "blocked" | "other") {
    super(message);
    this.name = "ProviderError";
  }
}

const BASE = () => process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";

function classify(status: number, body: string): ProviderError {
  const msg = (() => {
    try {
      return (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      return "";
    }
  })();
  if (status === 400 && /api key/i.test(msg)) return new ProviderError("Gemini rejected the API key as invalid.", status, "auth");
  if (status === 401 || status === 403) return new ProviderError("Gemini rejected the API key or it lacks access to this model.", status, "auth");
  if (status === 404) return new ProviderError("The selected Gemini model was not found or is not available to this key.", status, "model");
  if (status === 429) return new ProviderError("Gemini quota or rate limit reached.", status, "quota");
  return new ProviderError(`Gemini returned HTTP ${status}.`, status, "other");
}

async function call(apiKey: string, path: string, init: { method: string; body?: unknown; signal?: AbortSignal }, timeoutMs = 60_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  init.signal?.addEventListener("abort", () => ctl.abort(), { once: true });
  try {
    // Key goes in a header (x-goog-api-key), never in the URL, so it cannot leak into logs.
    const res = await fetch(`${BASE()}/${path}`, {
      method: init.method,
      headers: { "x-goog-api-key": apiKey, ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ctl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) throw classify(res.status, text);
    return JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    throw new ProviderError("Could not reach the Gemini API.", 0, "network");
  } finally {
    clearTimeout(t);
  }
}

export class GeminiProvider implements AnalysisProvider {
  id = "gemini";
  constructor(private apiKey: string, public model: string) {}

  async generateJson({ system, user, signal }: { system: string; user: string; signal?: AbortSignal }): Promise<string> {
    const r = await call(
      this.apiKey,
      `models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: "POST",
        signal,
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 8192 },
        },
      },
      90_000,
    );
    const cand = (r.candidates as { content?: { parts?: { text?: string }[] }; finishReason?: string }[] | undefined)?.[0];
    const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new ProviderError(`Gemini returned no content${cand?.finishReason ? ` (${cand.finishReason})` : ""}.`, 200, "blocked");
    return text;
  }
}

export async function getAnalysisProvider(userId: string): Promise<AnalysisProvider | null> {
  const key = await getCredential(userId, "gemini");
  if (!key) return null;
  return new GeminiProvider(key, (await getSettings(userId)).geminiModel);
}

export interface GeminiTestResult {
  ok: boolean;
  steps: { step: string; ok: boolean; message: string }[];
  message: string;
}

/** Two real requests: models.get (key + model access) then a one-token generateContent (quota). */
export async function testGemini(apiKey: string, model: string): Promise<GeminiTestResult> {
  const steps: GeminiTestResult["steps"] = [];
  try {
    const m = await call(apiKey, `models/${encodeURIComponent(model)}`, { method: "GET" }, 20_000);
    const methods = (m.supportedGenerationMethods as string[] | undefined) ?? [];
    const can = methods.length === 0 || methods.includes("generateContent");
    steps.push({ step: "model access", ok: can, message: can ? `Model ${model} is available to this key.` : `Model ${model} does not support generateContent.` });
    if (!can) return { ok: false, steps, message: steps[0]!.message };
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : "Could not reach the Gemini API.";
    steps.push({ step: "model access", ok: false, message: msg });
    return { ok: false, steps, message: msg };
  }
  try {
    await new GeminiProvider(apiKey, model).generateJson({ system: "Reply with JSON only.", user: 'Return {"ok":true}' });
    steps.push({ step: "generation", ok: true, message: "A test generation succeeded." });
    return { ok: true, steps, message: "Key, model access and generation all verified." };
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : "Generation failed.";
    steps.push({ step: "generation", ok: false, message: msg });
    return { ok: false, steps, message: msg };
  }
}
