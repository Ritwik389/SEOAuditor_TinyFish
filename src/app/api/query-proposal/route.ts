import { z } from "zod";
import { ApiError, route } from "@/lib/api";
import { proposeQuery } from "@/lib/analysis/semantic";
import { getCredential, getSettings } from "@/lib/config";
import { getAnalysisProvider } from "@/lib/gemini/provider";
import { validateTargetUrl } from "@/lib/security/ssrf";
import { tfFetch } from "@/lib/tinyfish/fetch";

export const maxDuration = 120;

/**
 * Proposes (never silently applies) a search query. This costs one TinyFish Fetch call and one Gemini call,
 * and the UI labels the result as automatically generated.
 */
export const POST = route({ rate: [6, 60_000], schema: z.object({ url: z.string().trim().min(1).max(2048) }) }, async ({ user, body }) => {
  const [key, provider] = await Promise.all([getCredential(user.userId, "tinyfish"), getAnalysisProvider(user.userId)]);
  if (!key) throw new ApiError(409, "integration_missing", "TinyFish is not configured for your account.");
  if (!provider) throw new ApiError(409, "integration_missing", "Query proposals need Gemini. Configure it on the Setup page, or type a query yourself.");
  const url = (await validateTargetUrl(body.url)).toString();
  const f = await tfFetch(key, { url, maxChars: (await getSettings(user.userId)).maxEvidenceChars }).catch(() => {
    throw new ApiError(502, "fetch_failed", "Could not fetch the page to propose a query.");
  });
  if (f.payload.error || f.payload.text.length < 50) throw new ApiError(422, "no_content", `The page could not be read (${f.payload.error?.code ?? "no text"}), so no query can be inferred. Enter one manually.`);
  try {
    const p = await proposeQuery(provider, f.payload);
    return { query: p.query, rationale: p.rationale, source: "inferred" as const, model: provider.model };
  } catch {
    throw new ApiError(502, "analysis_failed", "The analysis model could not propose a query. Enter one manually.");
  }
});
