import { TF_URLS, tfRequest } from "./client";
import type { FetchPayload, PageMetadata } from "../types";

interface RawFetch {
  results?: {
    url: string;
    final_url: string | null;
    title: string | null;
    description: string | null;
    language: string | null;
    text: unknown;
    author: string | null;
    published_date: string | null;
    links?: string[];
    page_metadata?: PageMetadata;
    latency_ms?: number | null;
  }[];
  errors?: { url: string; error: string; status?: number }[];
}

export interface FetchOutcome {
  payload: FetchPayload;
  requestId?: string;
  latencyMs: number;
}

const ERROR_TEXT: Record<string, string> = {
  page_not_found: "The target returned HTTP 404/410.",
  target_http_error: "The target server returned a non-2xx HTTP status.",
  target_unreachable: "The target could not be reached (DNS, TLS or connection failure).",
  timeout: "Fetching the page timed out.",
  proxy_error: "A proxy tunnel failure occurred while fetching.",
  bot_blocked: "A bot-challenge page (for example Cloudflare) was detected.",
  empty_content: "The page loaded but no extractable text was found.",
  login_required: "The page redirected to a login or account wall.",
  content_too_large: "The document exceeds the size limit.",
  invalid_url: "TinyFish rejected the URL (malformed or blocked address).",
  invalid_redirect_url: "A redirect target was rejected before fetching.",
};

/**
 * POST https://api.fetch.tinyfish.ai — markdown extraction with links + page_metadata.
 * `ttl: 0` asks for a live fetch; TinyFish may still serve a cached copy when the origin's
 * Cache-Control covers its age, so evidence is labelled "live-or-cache".
 */
export async function tfFetch(
  apiKey: string,
  p: { url: string; maxChars: number; signal?: AbortSignal; onAttempt?: (n: number) => void },
): Promise<FetchOutcome> {
  const res = await tfRequest<RawFetch>({
    url: TF_URLS.fetch(),
    method: "POST",
    apiKey,
    body: {
      urls: [p.url],
      format: "markdown",
      links: true,
      page_metadata: true,
      ttl: 0,
      per_url_timeout_ms: 60_000,
      purpose: "Audit how an AI-oriented retrieval tool sees this page (title, headings, content, metadata, links).",
    },
    timeoutMs: 90_000,
    signal: p.signal,
    onAttempt: p.onAttempt,
    retries: 1,
    retryTimeouts: false,
  });
  const raw = res.json ?? {};
  const ok = raw.results?.[0];
  const err = raw.errors?.[0];
  const base = { requestedUrl: p.url, text: "", textLength: 0, textTruncated: false } as const;
  if (!ok) {
    const code = err?.error ?? "unknown";
    return {
      requestId: res.requestId,
      latencyMs: res.latencyMs,
      payload: {
        ...base,
        finalUrl: null, title: null, description: null, language: null, author: null, publishedDate: null, pageMetadata: null, links: null, latencyMs: null,
        error: { code, status: err?.status, message: ERROR_TEXT[code] ?? `Fetch failed (${code}).` },
      },
    };
  }
  const full = typeof ok.text === "string" ? ok.text : ok.text ? JSON.stringify(ok.text) : "";
  return {
    requestId: res.requestId,
    latencyMs: res.latencyMs,
    payload: {
      requestedUrl: ok.url ?? p.url,
      finalUrl: ok.final_url ?? null,
      title: ok.title ?? null,
      description: ok.description ?? null,
      language: ok.language ?? null,
      author: ok.author ?? null,
      publishedDate: ok.published_date ?? null,
      text: full.slice(0, p.maxChars),
      textLength: full.length,
      textTruncated: full.length > p.maxChars,
      pageMetadata: ok.page_metadata ?? null,
      links: ok.links ?? null,
      latencyMs: ok.latency_ms ?? null,
    },
  };
}
