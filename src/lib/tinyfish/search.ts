import { TF_URLS, tfRequest } from "./client";
import type { SearchResultItem } from "../types";

interface RawSearch {
  query?: string;
  results?: { position?: number; site_name?: string; title?: string; snippet?: string; url?: string }[];
  total_results?: number;
  page?: number;
}

export interface SearchOutcome {
  query: string;
  page: number;
  totalResults?: number;
  results: SearchResultItem[];
  requestId?: string;
  latencyMs: number;
}

/** GET https://api.search.tinyfish.ai?query=… (documented: X-API-Key header, location/language optional) */
export async function tfSearch(
  apiKey: string,
  p: { query: string; location?: string; language?: string; purpose?: string; signal?: AbortSignal; onAttempt?: (n: number) => void },
): Promise<SearchOutcome> {
  const u = new URL(TF_URLS.search());
  u.searchParams.set("query", p.query);
  if (p.location) u.searchParams.set("location", p.location);
  if (p.language) u.searchParams.set("language", p.language);
  if (p.purpose) u.searchParams.set("purpose", p.purpose.slice(0, 2000));
  const res = await tfRequest<RawSearch>({ url: u.toString(), method: "GET", apiKey, timeoutMs: 30_000, signal: p.signal, onAttempt: p.onAttempt, retries: 2 });
  const raw = res.json ?? {};
  return {
    query: raw.query ?? p.query,
    page: raw.page ?? 0,
    totalResults: raw.total_results,
    requestId: res.requestId,
    latencyMs: res.latencyMs,
    results: (raw.results ?? [])
      .filter((r) => typeof r.url === "string")
      .map((r, i) => ({ position: r.position ?? i + 1, title: r.title ?? "", url: r.url!, snippet: r.snippet ?? "", siteName: r.site_name ?? "" })),
  };
}
