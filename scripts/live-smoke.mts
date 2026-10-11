/**
 * OPTIONAL live smoke test. Makes REAL requests to TinyFish (and Gemini if a key is given) and may consume
 * free-allowance or wallet credit. It is never run by `npm test`.
 *
 *   TINYFISH_API_KEY=... [GEMINI_API_KEY=...] [SMOKE_BROWSER=1] npm run smoke:live
 *
 * SMOKE_BROWSER=1 additionally creates and terminates one real (billable) Browser session.
 */
import { testGemini } from "../src/lib/gemini/provider";
import { tfFetch } from "../src/lib/tinyfish/fetch";
import { tfSearch } from "../src/lib/tinyfish/search";
import { testTinyFishOperation } from "../src/lib/tinyfish/test";

const key = process.env.TINYFISH_API_KEY;
if (!key) {
  console.error("Set TINYFISH_API_KEY to run the live smoke test. Nothing was called.");
  process.exit(2);
}

let failed = 0;
const report = (name: string, ok: boolean, detail: string) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`);
};

const s = await tfSearch(key, { query: "example domain", purpose: "Sniffsite live smoke test" }).catch((e) => e as Error);
report("TinyFish Search", !(s instanceof Error), s instanceof Error ? s.message : `${s.results.length} results (request ${s.requestId ?? "n/a"})`);

const f = await tfFetch(key, { url: "https://example.com/", maxChars: 5000 }).catch((e) => e as Error);
report("TinyFish Fetch", !(f instanceof Error) && !f.payload.error, f instanceof Error ? f.message : f.payload.error ? f.payload.error.message : `${f.payload.textLength} chars, title "${f.payload.title}", metadata ${f.payload.pageMetadata ? "present" : "absent"}`);

if (process.env.SMOKE_BROWSER === "1") {
  const b = await testTinyFishOperation(key, "browser");
  report("TinyFish Browser", b.ok, b.message);
} else console.log("SKIP  TinyFish Browser: set SMOKE_BROWSER=1 to create a (billable) session");

if (process.env.GEMINI_API_KEY) {
  const g = await testGemini(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL || "gemini-3.8-flash");
  report("Gemini", g.ok, g.message);
} else console.log("SKIP  Gemini: set GEMINI_API_KEY to test it");

process.exit(failed ? 1 : 0);
