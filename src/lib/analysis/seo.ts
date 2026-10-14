import type { BrowserPayload, CheckStatus, FetchPayload, RobotsPayload, SitemapPayload, TechnicalCheck } from "../types";
import { normalizeUrl } from "../url";
import { parseHeadings, extractFromFetch } from "./extract";
import { words } from "./text";

export interface SeoInput {
  targetUrl: string;
  fetch?: { evidenceId: string; payload: FetchPayload };
  browser?: { evidenceId: string; payload: BrowserPayload };
  robots?: { evidenceId: string; payload: RobotsPayload };
  sitemap?: { evidenceId: string; payload: SitemapPayload };
}

const chk = (checkId: string, label: string, status: CheckStatus, observed: string, evidenceRefs: string[], extra: Partial<TechnicalCheck> = {}): TechnicalCheck => ({
  checkId, label, status, observed, evidenceRefs, kind: "observed", ...extra,
});

/** Pure, deterministic technical checks. Anything we did not actually observe is `not_checked` / `unknown`. */
export function runSeoChecks(i: SeoInput): TechnicalCheck[] {
  const out: TechnicalCheck[] = [];
  const f = i.fetch?.payload;
  const fe = i.fetch ? [i.fetch.evidenceId] : [];
  const b = i.browser?.payload;
  const be = i.browser ? [i.browser.evidenceId] : [];

  if (!f || f.error) {
    const why = f?.error ? `Fetch failed (${f.error.code}).` : "Fetch did not run.";
    for (const [id, label] of [["title", "Title"], ["meta_description", "Meta description"], ["h1", "H1 and heading structure"], ["canonical", "Canonical URL"], ["robots_meta", "Robots meta directives"], ["content_volume", "Extracted content volume"], ["internal_links", "Internal links"]] as const)
      out.push(chk(id, label, "not_checked", why, fe));
  } else {
    const heads = parseHeadings(f.text);
    const h1s = heads.filter((h) => h.level === 1);
    const meta = f.pageMetadata;

    out.push(
      !f.title
        ? chk("title", "Title", "fail", "Fetch returned no page title.", fe)
        : chk("title", "Title", f.title.length < 15 || f.title.length > 65 ? "warning" : "pass", `"${f.title}" (${f.title.length} characters)`, fe, {
            note: f.title.length > 65 ? "Longer titles are often truncated in search results." : f.title.length < 15 ? "Very short titles carry little information." : undefined,
          }),
    );
    out.push(
      !f.description
        ? chk("meta_description", "Meta description", "warning", "Fetch reported no meta description for this page.", fe, { note: "Fetch returns the description it detected; confirm in the page source." })
        : chk("meta_description", "Meta description", f.description.length < 70 || f.description.length > 170 ? "warning" : "pass", `${f.description.length} characters`, fe, { note: f.description }),
    );
    out.push(
      h1s.length === 0
        ? chk("h1", "H1 and heading structure", "warning", "No H1 was observed in the extracted content.", fe, { kind: "inferred", note: "Extraction can drop headings; verify in the rendered page." })
        : h1s.length > 1
          ? chk("h1", "H1 and heading structure", "warning", `${h1s.length} H1 headings observed: ${h1s.map((h) => `"${h.text}"`).join(", ")}`, fe)
          : chk("h1", "H1 and heading structure", skipsLevel(heads) ? "warning" : "pass", `H1: "${h1s[0]!.text}" · ${heads.length} headings`, fe, { note: skipsLevel(heads) ? "Heading levels skip (for example H2 to H4)." : undefined }),
    );

    if (!meta) out.push(chk("canonical", "Canonical URL", "unknown", "Fetch did not return page metadata.", fe));
    else if (!meta.canonical) out.push(chk("canonical", "Canonical URL", "warning", "No canonical URL observed in page metadata.", fe));
    else {
      const same = normalizeUrl(meta.canonical) === normalizeUrl(f.finalUrl ?? f.requestedUrl);
      out.push(chk("canonical", "Canonical URL", same ? "pass" : "warning", same ? meta.canonical : `Canonical points to ${meta.canonical}, which differs from the fetched URL.`, fe));
    }

    const robotsMeta = (meta?.robots as string | undefined) ?? b?.robotsMeta ?? undefined;
    if (!meta && !b) out.push(chk("robots_meta", "Robots meta directives", "unknown", "Page metadata was not returned.", fe));
    else if (robotsMeta && /noindex/i.test(robotsMeta)) out.push(chk("robots_meta", "Robots meta directives", "fail", `robots meta contains "${robotsMeta}".`, [...fe, ...be]));
    else if (robotsMeta && /nofollow/i.test(robotsMeta)) out.push(chk("robots_meta", "Robots meta directives", "warning", `robots meta contains "${robotsMeta}".`, [...fe, ...be]));
    else out.push(chk("robots_meta", "Robots meta directives", "pass", robotsMeta ? `robots meta: "${robotsMeta}"` : "No restrictive robots meta directive observed.", [...fe, ...be]));

    const wc = words(f.text);
    out.push(chk("content_volume", "Extracted content volume", wc < 150 ? "warning" : "pass", `${wc} words extracted${f.textTruncated ? " (stored copy truncated)" : ""}.`, fe, { note: wc < 150 ? "Very little text was extracted; the page may be thin or rendered client-side." : undefined }));

    const ex = extractFromFetch(f);
    out.push(
      ex.internalLinks === null
        ? chk("internal_links", "Internal links", "not_checked", "Fetch did not return links.", fe)
        : chk("internal_links", "Internal links", ex.internalLinks > 0 ? "pass" : "warning", `${ex.internalLinks} internal and ${ex.externalLinks} external links extracted.`, fe),
    );

    const og = meta?.og as Record<string, unknown> | undefined;
    out.push(meta ? chk("open_graph", "Open Graph tags", og && og.title && og.description ? "pass" : "warning", og ? `og keys: ${Object.keys(og).join(", ") || "none"}` : "No Open Graph tags observed.", fe) : chk("open_graph", "Open Graph tags", "unknown", "Page metadata was not returned.", fe));
  }

  // Structured data needs real DOM access, which Fetch markdown cannot provide.
  if (b) {
    const bad = b.jsonLd.filter((j) => !j.valid).length;
    out.push(
      b.jsonLd.length === 0
        ? chk("structured_data", "Structured data (JSON-LD)", "warning", "No JSON-LD scripts found in the rendered page.", be)
        : chk("structured_data", "Structured data (JSON-LD)", bad ? "fail" : "pass", `${b.jsonLd.length} block(s): ${b.jsonLd.flatMap((j) => j.types).join(", ") || "no @type"}${bad ? ` · ${bad} failed to parse` : ""}`, be),
    );
  } else out.push(chk("structured_data", "Structured data (JSON-LD)", "not_checked", "Needs rendered HTML. Fetch returns extracted Markdown and Browser verification did not run.", []));

  const r = i.robots?.payload;
  const re = i.robots ? [i.robots.evidenceId] : [];
  if (!r) out.push(chk("robots_txt", "robots.txt", "not_checked", "robots.txt was not fetched.", []));
  else if (r.error) out.push(chk("robots_txt", "robots.txt", "unknown", `Could not retrieve robots.txt: ${r.error}`, re));
  else if (r.status === 404) out.push(chk("robots_txt", "robots.txt", "pass", "No robots.txt (HTTP 404): no crawl restrictions are declared.", re));
  else if (r.status !== 200) out.push(chk("robots_txt", "robots.txt", "unknown", `robots.txt returned HTTP ${r.status}.`, re));
  else if (r.genericDisallowsPath) out.push(chk("robots_txt", "robots.txt", "fail", `A rule for all crawlers disallows this path (${r.matchedRule}).`, re));
  else if (r.aiBotDisallows.length) out.push(chk("robots_txt", "robots.txt", "warning", `Disallow rules apply to: ${r.aiBotDisallows.join(", ")}.`, re, { note: "Directives are declared preferences; compliance depends on each crawler." }));
  else out.push(chk("robots_txt", "robots.txt", "pass", "No rule found that disallows this path for the generic or named AI crawlers checked.", re));

  const s = i.sitemap?.payload;
  const se = i.sitemap ? [i.sitemap.evidenceId] : [];
  if (!s) out.push(chk("sitemap", "Sitemap discoverability", "not_checked", "No sitemap lookup was made.", []));
  else if (s.error || s.status === null) out.push(chk("sitemap", "Sitemap discoverability", "unknown", `Could not retrieve ${s.url}: ${s.error ?? "no response"}`, se));
  else if (s.status !== 200) out.push(chk("sitemap", "Sitemap discoverability", "warning", `No sitemap found at ${s.url} (HTTP ${s.status}).`, se));
  else if (s.listsTarget === true) out.push(chk("sitemap", "Sitemap discoverability", "pass", `Sitemap lists this URL (${s.urlCount} URLs).`, se));
  else if (s.listsTarget === null) out.push(chk("sitemap", "Sitemap discoverability", "unknown", s.isIndex ? "Sitemap index found; child sitemaps were not traversed." : "Sitemap could not be fully read.", se));
  else out.push(chk("sitemap", "Sitemap discoverability", "warning", `Sitemap found (${s.urlCount} URLs) but this URL is not listed.`, se));

  out.push(chk("broken_links", "Broken links", "not_checked", "Links were not individually requested. SEOAuditor does not test links in this version.", []));
  return out;
}

function skipsLevel(h: { level: number }[]): boolean {
  return h.some((x, idx) => idx > 0 && x.level - h[idx - 1]!.level > 1);
}
