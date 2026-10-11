import type { MatchMethod } from "./types";

const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_eid|mc_cid|igshid|ref|ref_src|_ga|yclid)$/i;

/** Canonical comparison key: scheme/hash/www/trailing-slash/tracking params removed, params sorted. */
export function normalizeUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return input.trim().toLowerCase();
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const port = u.port && !["80", "443"].includes(u.port) ? `:${u.port}` : "";
  let path = u.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const qs = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
  return `${host}${port}${path}${qs}`;
}

function hostPath(input: string): string {
  const n = normalizeUrl(input);
  const i = n.indexOf("?");
  return i === -1 ? n : n.slice(0, i);
}

export interface Match {
  method: MatchMethod;
}

/**
 * Decide whether a search-result URL is the target page. Different hosts (including
 * different subdomains other than www) never match.
 */
export function matchTarget(
  target: string,
  resultUrl: string,
  opts: { finalUrl?: string | null; canonical?: string | null } = {},
): Match | null {
  if (target === resultUrl) return { method: "exact" };
  const t = normalizeUrl(target);
  const r = normalizeUrl(resultUrl);
  if (t === r) return { method: "normalized" };
  if (opts.finalUrl && normalizeUrl(opts.finalUrl) === r) return { method: "final-url" };
  if (opts.canonical && normalizeUrl(opts.canonical) === r) return { method: "canonical" };
  if (hostPath(target) === hostPath(resultUrl)) return { method: "same-path-different-query" };
  return null;
}

export function hostOf(input: string): string {
  try {
    return new URL(input).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function sameSite(a: string, b: string): boolean {
  return hostOf(a) !== "" && hostOf(a) === hostOf(b);
}
