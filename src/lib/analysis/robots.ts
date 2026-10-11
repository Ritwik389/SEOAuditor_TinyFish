import type { RobotsPayload, SitemapPayload } from "../types";
import { normalizeUrl } from "../url";
import { safeFetch } from "../security/ssrf";

export const AI_BOTS = ["GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "anthropic-ai", "PerplexityBot", "Google-Extended", "CCBot", "Bytespider", "Applebot-Extended"];

interface Group {
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
}

export function parseRobots(body: string): { groups: Group[]; sitemaps: string[] } {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1]!.toLowerCase();
    const v = m[2]!.trim();
    if (k === "sitemap") sitemaps.push(v);
    else if (k === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
      continue;
    } else if ((k === "allow" || k === "disallow") && cur) cur.rules.push({ allow: k === "allow", pattern: v });
    lastWasAgent = false;
  }
  return { groups, sitemaps };
}

function patternMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const re = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  return re.test(path);
}

/** Longest-match wins, Allow wins ties (RFC 9309). */
export function evaluate(groups: Group[], agent: string, path: string, opts: { fallbackToStar: boolean }) {
  const a = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.includes(a));
  const sel = specific.length ? specific : opts.fallbackToStar ? groups.filter((g) => g.agents.includes("*")) : [];
  if (!sel.length) return { hasGroup: false, allowed: true as boolean, rule: undefined as string | undefined };
  let best: { allow: boolean; pattern: string } | null = null;
  for (const r of sel.flatMap((g) => g.rules))
    if (patternMatches(r.pattern, path) && (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow))) best = r;
  return { hasGroup: true, allowed: best ? best.allow : true, rule: best ? `${best.allow ? "Allow" : "Disallow"}: ${best.pattern}` : undefined };
}

export function analyzeRobots(body: string, targetUrl: string): Pick<RobotsPayload, "genericDisallowsPath" | "matchedRule" | "aiBotDisallows" | "sitemaps"> {
  const { groups, sitemaps } = parseRobots(body);
  const u = new URL(targetUrl);
  const path = u.pathname + u.search;
  const star = evaluate(groups, "*", path, { fallbackToStar: true });
  return {
    genericDisallowsPath: star.hasGroup ? !star.allowed : false,
    matchedRule: star.rule,
    aiBotDisallows: AI_BOTS.filter((b) => {
      const r = evaluate(groups, b, path, { fallbackToStar: false });
      return r.hasGroup && !r.allowed;
    }),
    sitemaps,
  };
}

/** Fetches robots.txt and (if referenced or at /sitemap.xml) one sitemap, SSRF-safely. */
export async function collectSiteFiles(targetUrl: string, signal?: AbortSignal): Promise<{ robots: RobotsPayload; sitemap: SitemapPayload | null }> {
  const origin = new URL(targetUrl).origin;
  const robotsUrl = `${origin}/robots.txt`;
  let robots: RobotsPayload = { url: robotsUrl, status: null, bodySample: "", genericDisallowsPath: null, aiBotDisallows: [], sitemaps: [] };
  try {
    const r = await safeFetch(robotsUrl, { signal, timeoutMs: 8000, maxBytes: 200_000 });
    const looksLikeRobots = r.status === 200 && !/text\/html/i.test(r.contentType);
    robots = {
      url: robotsUrl,
      status: r.status,
      bodySample: looksLikeRobots ? r.body.slice(0, 3000) : "",
      ...(looksLikeRobots ? analyzeRobots(r.body, targetUrl) : { genericDisallowsPath: null, aiBotDisallows: [], sitemaps: [] }),
    };
  } catch (e) {
    robots.error = e instanceof Error ? e.message.slice(0, 200) : "request failed";
  }

  const sitemapUrl = robots.sitemaps[0] ?? `${origin}/sitemap.xml`;
  let sitemap: SitemapPayload | null = null;
  try {
    const r = await safeFetch(sitemapUrl, { signal, timeoutMs: 8000, maxBytes: 2_000_000 });
    if (r.status !== 200) sitemap = { url: sitemapUrl, status: r.status, isIndex: false, listsTarget: null, urlCount: null };
    else {
      const isIndex = /<sitemapindex/i.test(r.body);
      const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
      const t = normalizeUrl(targetUrl);
      sitemap = {
        url: sitemapUrl,
        status: r.status,
        isIndex,
        urlCount: locs.length,
        // An index lists other sitemaps, and a truncated read can miss entries: both leave this unknown.
        listsTarget: isIndex || r.truncated ? (locs.some((l) => normalizeUrl(l) === t) ? true : null) : locs.some((l) => normalizeUrl(l) === t),
      };
    }
  } catch (e) {
    sitemap = { url: sitemapUrl, status: null, isIndex: false, listsTarget: null, urlCount: null, error: e instanceof Error ? e.message.slice(0, 200) : "request failed" };
  }
  return { robots, sitemap };
}
