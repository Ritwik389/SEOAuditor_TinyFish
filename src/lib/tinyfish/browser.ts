import type { Browser } from "playwright-core";
import { TF_URLS, tfRequest } from "./client";
import type { BrowserPayload } from "../types";

// TinyFish Browser: POST https://api.browser.tinyfish.ai -> { session_id, cdp_url, base_url }.
// We drive the remote Chromium over CDP (documented path) and terminate it with
// DELETE https://api.browser.tinyfish.ai/{session_id}. Sessions bill against the wallet, so this
// is only called when a verification objective exists.

interface Session {
  session_id: string;
  cdp_url: string;
  base_url: string;
}

export async function createSession(apiKey: string, p: { url?: string; signal?: AbortSignal; onAttempt?: (n: number) => void }) {
  const res = await tfRequest<Session>({
    url: TF_URLS.browser(),
    method: "POST",
    apiKey,
    body: { ...(p.url ? { url: p.url } : {}), timeout_seconds: 180 },
    timeoutMs: 75_000, // docs: creation takes 10-30s; use >= 60s client timeout
    retries: 1,
    retryTimeouts: false,
    signal: p.signal,
    onAttempt: p.onAttempt,
  });
  if (!res.json?.session_id || !res.json.cdp_url) throw new Error("TinyFish Browser returned an unexpected response.");
  return { session: res.json, requestId: res.requestId, latencyMs: res.latencyMs };
}

export async function endSession(apiKey: string, sessionId: string) {
  try {
    await tfRequest({ url: `${TF_URLS.browser()}/${encodeURIComponent(sessionId)}`, method: "DELETE", apiKey, timeoutMs: 15_000, retries: 2 });
    return true;
  } catch {
    return false;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();

/** Rendered headings that never appear in the Fetch text. Pure, unit-tested. */
export function headingsMissingFromFetch(rendered: { level: number; text: string }[], fetchText: string): string[] {
  const hay = norm(fetchText);
  return rendered
    .filter((h) => h.level <= 3 && norm(h.text).length >= 4)
    .filter((h) => !hay.includes(norm(h.text)))
    .map((h) => h.text.slice(0, 160))
    .slice(0, 15);
}

export async function verifyInBrowser(
  apiKey: string,
  p: { url: string; objective: string; fetchText: string; signal?: AbortSignal; onAttempt?: (n: number) => void },
): Promise<{ payload: BrowserPayload; sessionId: string; requestId?: string }> {
  const { session, requestId } = await createSession(apiKey, { url: p.url, signal: p.signal, onAttempt: p.onAttempt });
  let browser: Browser | undefined;
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.connectOverCDP(session.cdp_url, { timeout: 45_000 });
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    if (page.url() === "about:blank" || !page.url()) await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 45_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined); // best effort for JS-rendered content
    const data = await page.evaluate(() => {
      const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
      const headings = [...document.querySelectorAll("h1,h2,h3,h4")].slice(0, 80).map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? "").replace(/\s+/g, " ").trim() })).filter((h) => h.text);
      const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 10).map((s) => {
        const raw = s.textContent ?? "";
        try {
          const parsed = JSON.parse(raw);
          const items = Array.isArray(parsed) ? parsed : parsed["@graph"] ?? [parsed];
          const types = items.flatMap((i: { "@type"?: string | string[] }) => (i && i["@type"] ? [i["@type"]].flat() : [])).map(String);
          return { valid: true, types: types.slice(0, 10), sample: raw.slice(0, 400) };
        } catch {
          return { valid: false, types: [] as string[], sample: raw.slice(0, 400) };
        }
      });
      return {
        title: document.title,
        finalUrl: location.href,
        text,
        headings,
        jsonLd,
        canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null,
        robotsMeta: document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content ?? null,
        linkCount: document.querySelectorAll("a[href]").length,
      };
    });
    return {
      sessionId: session.session_id,
      requestId,
      payload: {
        requestedUrl: p.url,
        finalUrl: data.finalUrl,
        title: data.title.slice(0, 300),
        headings: data.headings.map((h) => ({ ...h, text: h.text.slice(0, 200) })),
        visibleTextLength: data.text.length,
        visibleTextSample: data.text.slice(0, 3000),
        jsonLd: data.jsonLd,
        canonical: data.canonical,
        robotsMeta: data.robotsMeta,
        linkCount: data.linkCount,
        objective: p.objective,
        missingFromFetch: headingsMissingFromFetch(data.headings, p.fetchText),
      },
    };
  } finally {
    await browser?.close().catch(() => undefined);
    await endSession(apiKey, session.session_id);
  }
}
