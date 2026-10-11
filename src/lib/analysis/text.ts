const STOP = new Set(
  "a an and are as at be but by for from has have how i in into is it its of on or our that the their this to was we what when where which who why will with you your vs best top new free online near me can do does get use using".split(" "),
);

export const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** Crude singularisation so "plans" matches "plan". */
export const stem = (w: string) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

export function terms(s: string, minLen = 3): string[] {
  return [...new Set(norm(s).split(" ").filter((w) => w.length >= minLen && !STOP.has(w)).map(stem))];
}

export function hasTerm(haystack: string, term: string): boolean {
  const h = norm(haystack);
  return h.split(" ").some((w) => stem(w) === term) || h.includes(term);
}

export function words(s: string): number {
  return (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

/** Whole-excerpt containment check used to verify model-quoted evidence. */
export function containsExcerpt(haystack: string, excerpt: string): boolean {
  const e = norm(excerpt);
  return e.length >= 6 && norm(haystack).includes(e);
}

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
