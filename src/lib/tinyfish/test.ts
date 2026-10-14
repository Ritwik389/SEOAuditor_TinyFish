import { tfSearch } from "./search";
import { tfFetch } from "./fetch";
import { createSession, endSession } from "./browser";
import { TinyFishError } from "./client";

export type TfOperation = "search" | "fetch" | "browser";
export interface OpResult {
  operation: TfOperation;
  ok: boolean;
  message: string;
  httpStatus?: number;
  latencyMs?: number;
  requestId?: string;
}

const fail = (operation: TfOperation, e: unknown): OpResult => {
  if (e instanceof TinyFishError) return { operation, ok: false, message: `${e.message} [${e.code}${e.requestId ? ", request " + e.requestId : ""}]`, httpStatus: e.status || undefined, requestId: e.requestId };
  return { operation, ok: false, message: "Unexpected error while testing this operation." };
};

/**
 * Each operation is exercised with a REAL request. A pass on one never implies the others work.
 * Browser opens (and immediately terminates) a real session, which can consume wallet credit.
 */
export async function testTinyFishOperation(apiKey: string, operation: TfOperation): Promise<OpResult> {
  const t0 = Date.now();
  try {
    if (operation === "search") {
      const r = await tfSearch(apiKey, { query: "tinyfish web search api", purpose: "SEOAuditor connection test" });
      return { operation, ok: true, message: `Search returned ${r.results.length} result(s).`, latencyMs: Date.now() - t0, requestId: r.requestId };
    }
    if (operation === "fetch") {
      const r = await tfFetch(apiKey, { url: "https://example.com/", maxChars: 2000 });
      if (r.payload.error) return { operation, ok: false, message: `Fetch call worked but the test page failed: ${r.payload.error.message}`, latencyMs: Date.now() - t0 };
      return { operation, ok: true, message: `Fetch extracted ${r.payload.textLength} characters from the test page.`, latencyMs: Date.now() - t0, requestId: r.requestId };
    }
    const { session, requestId } = await createSession(apiKey, {});
    const ended = await endSession(apiKey, session.session_id);
    return { operation, ok: true, message: ended ? "Browser session created and terminated." : "Browser session created; termination not confirmed (it will expire on inactivity).", latencyMs: Date.now() - t0, requestId };
  } catch (e) {
    return { ...fail(operation, e), latencyMs: Date.now() - t0 };
  }
}
