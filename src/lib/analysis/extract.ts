import type { BrowserPayload, ExtractionSummary, FetchPayload } from "../types";
import { sameSite } from "../url";
import { clip, words } from "./text";

/** ATX headings from Markdown, ignoring fenced code blocks. */
export function parseHeadings(md: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  let fence = false;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) out.push({ level: m[1]!.length, text: m[2]!.replace(/[*_`[\]]/g, "").trim() });
  }
  return out;
}

const PRICE = /(?:[$€£₹]|USD|EUR|GBP|INR)\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?(?:\/|per)\s?(?:mo|month|yr|year|user|seat|week|day))?/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3}[\s.-]\d{3,4}\b/g;

function uniq(m: RegExpMatchArray | null, max: number) {
  return [...new Set((m ?? []).map((x) => x.trim()))].slice(0, max);
}

export function extractFromFetch(f: FetchPayload, browser?: BrowserPayload): ExtractionSummary {
  const headings = parseHeadings(f.text);
  const base = f.finalUrl ?? f.requestedUrl;
  let internal: number | null = null;
  let external: number | null = null;
  let sample: string[] = [];
  if (f.links) {
    const abs = f.links.filter((l) => /^https?:/i.test(l));
    const inside = abs.filter((l) => sameSite(l, base));
    internal = new Set(inside).size;
    external = new Set(abs.filter((l) => !sameSite(l, base))).size;
    sample = [...new Set(inside)].slice(0, 12);
  }
  const facts = [
    ...uniq(f.text.match(PRICE), 12).map((value) => ({ type: "price", value })),
    ...uniq(f.text.match(EMAIL), 4).map((value) => ({ type: "email", value })),
    ...uniq(f.text.match(PHONE), 4).map((value) => ({ type: "phone", value })),
  ];
  return {
    headings: headings.slice(0, 60),
    wordCount: words(f.text),
    mainContentExcerpt: clip(f.text.replace(/\s+/g, " ").trim(), 1400),
    facts,
    internalLinks: internal,
    externalLinks: external,
    sampleInternalLinks: sample,
    absentFromExtraction: browser?.missingFromFetch ?? [],
    entities: [],
  };
}
