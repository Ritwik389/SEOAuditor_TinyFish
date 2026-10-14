// Low-level TinyFish HTTP client: X-API-Key auth, bounded timeouts, controlled retries.
// Contracts verified against https://docs.tinyfish.ai/ and the OpenAPI documents at
// https://agent.tinyfish.ai/v1/openapi/{search,fetch,browser}.

export const TF_URLS = {
  search: () => process.env.TINYFISH_SEARCH_URL || "https://api.search.tinyfish.ai",
  fetch: () => process.env.TINYFISH_FETCH_URL || "https://api.fetch.tinyfish.ai",
  browser: () => process.env.TINYFISH_BROWSER_URL || "https://api.browser.tinyfish.ai",
  agent: () => (process.env.TINYFISH_AGENT_URL || "https://agent.tinyfish.ai/v1").replace(/\/$/, ""),
};

export class TinyFishError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public retryable: boolean,
    public requestId?: string,
    public retryAfterSec?: number,
  ) {
    super(message);
    this.name = "TinyFishError";
  }
}

export interface TfRequest {
  url: string;
  method: "GET" | "POST" | "DELETE";
  apiKey: string;
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Extra attempts after the first. Retries only 429/502/503/504/409 and network failures. */
  retries?: number;
  retryTimeouts?: boolean;
  onAttempt?: (attempt: number) => void;
}

export interface TfResponse<T> {
  status: number;
  json: T | null;
  requestId?: string;
  latencyMs: number;
  rateLimit?: { limit?: string; remaining?: string };
}

const NON_RETRYABLE_CODES = new Set(["DAILY_LIMIT_EXCEEDED", "FREE_ALLOWANCE_EXHAUSTED", "INSUFFICIENT_CREDITS", "INVALID_API_KEY", "MISSING_API_KEY"]);
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), rej(new DOMException("Aborted", "AbortError"))), { once: true });
  });

export function friendlyMessage(status: number, code: string, fallback: string): string {
  switch (code) {
    case "MISSING_API_KEY":
    case "INVALID_API_KEY":
    case "UNAUTHORIZED":
      return "TinyFish rejected the API key (invalid, revoked or missing). Create a new key at agent.tinyfish.ai/api-keys.";
    case "INSUFFICIENT_CREDITS":
      return "TinyFish reports insufficient wallet credits for this operation.";
    case "FREE_ALLOWANCE_EXHAUSTED":
      return "The daily free allowance for this TinyFish product is used up (resets 00:00 UTC) and no wallet credit is available.";
    case "DAILY_LIMIT_EXCEEDED":
      return "TinyFish daily limit reached for this capability. Retrying today will not help.";
    case "RATE_LIMIT_EXCEEDED":
      return "TinyFish rate limit hit. Wait a moment and retry.";
    case "FORBIDDEN":
      return "This TinyFish operation is not enabled for the account (entitlement or credits missing).";
    case "FEATURE_NOT_AVAILABLE":
    case "NOT_FOUND":
      if (status === 404) return "This TinyFish API is not available for the account.";
      break;
    case "SERVICE_BUSY":
    case "BACKEND_UNAVAILABLE":
      return "TinyFish is temporarily unavailable.";
    case "INVALID_INPUT":
      return "TinyFish rejected the request parameters: " + fallback;
  }
  return fallback;
}

export async function tfRequest<T>(r: TfRequest): Promise<TfResponse<T>> {
  const retries = r.retries ?? 2;
  let lastErr: TinyFishError | null = null;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    if (r.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    r.onAttempt?.(attempt);
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new DOMException("timeout", "TimeoutError")), r.timeoutMs);
    const onAbort = () => ctl.abort(r.signal?.reason);
    r.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(r.url, {
        method: r.method,
        headers: { "X-API-Key": r.apiKey, ...(r.body ? { "Content-Type": "application/json" } : {}), Accept: "application/json" },
        body: r.body ? JSON.stringify(r.body) : undefined,
        signal: ctl.signal,
        cache: "no-store",
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON body */
      }
      const requestId = res.headers.get("x-request-id") ?? (json as { request_id?: string } | null)?.request_id ?? undefined;
      if (res.ok) {
        return {
          status: res.status,
          json: json as T,
          requestId,
          latencyMs: Date.now() - t0,
          rateLimit: { limit: res.headers.get("x-ratelimit-limit") ?? undefined, remaining: res.headers.get("x-ratelimit-remaining") ?? undefined },
        };
      }
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      const code = err?.code ?? `HTTP_${res.status}`;
      const retryAfter = Number(res.headers.get("retry-after")) || undefined;
      const retryable = !NON_RETRYABLE_CODES.has(code) && [409, 429, 502, 503, 504].includes(res.status);
      lastErr = new TinyFishError(friendlyMessage(res.status, code, err?.message ?? `TinyFish returned HTTP ${res.status}`), res.status, code, retryable, requestId, retryAfter);
      if (!retryable || attempt > retries) throw lastErr;
      await sleep(Math.min((retryAfter ?? 0.6 * 2 ** (attempt - 1)) * 1000 + Math.random() * 250, 8000), r.signal);
    } catch (e) {
      if (e instanceof TinyFishError) {
        if (!e.retryable || attempt > retries) throw e;
        continue;
      }
      if (r.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const timedOut = e instanceof DOMException && e.name === "TimeoutError";
      lastErr = new TinyFishError(timedOut ? "The TinyFish request timed out." : "Could not reach TinyFish (network error).", 0, timedOut ? "TIMEOUT" : "NETWORK", true);
      if (attempt > retries || (timedOut && !r.retryTimeouts)) throw lastErr;
      await sleep(400 * attempt, r.signal);
    } finally {
      clearTimeout(timer);
      r.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw lastErr ?? new TinyFishError("TinyFish request failed.", 0, "UNKNOWN", false);
}
