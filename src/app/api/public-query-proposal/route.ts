import { z } from "zod";
import { ApiError, route } from "@/lib/api";
import { proposeQuery } from "@/lib/analysis/semantic";
import { publicDemoEnabled, publicDeps } from "@/lib/public-demo";
import { validateTargetUrl } from "@/lib/security/ssrf";

export const maxDuration = 120;
export const POST = route({ auth: false, rate: [6, 60000], schema: z.object({ url: z.string().trim().min(1).max(2048) }) }, async ({ body, req }) => {
  if (!publicDemoEnabled()) throw new ApiError(404, "not_found", "Public audits are unavailable.");
  const deps = publicDeps();
  const key = await deps.apiKey("");
  if (!key) throw new ApiError(503, "integration_missing", "The demo's TinyFish key is not configured.");
  const url = (await validateTargetUrl(body.url)).toString();
  const f = await deps.fetch(key, { url, maxChars: 12000, signal: req.signal });
  if (f.payload.error || !f.payload.text.trim()) throw new ApiError(422, "no_content", "The page could not be read. Enter a query manually.");
  const provider = await deps.provider("");
  if (provider) {
    try { return { ...(await proposeQuery(provider, f.payload)), source: "inferred", model: provider.model }; }
    catch { /* An extracted title remains a useful, explicitly labelled suggestion. */ }
  }
  const title = f.payload.title?.trim() || f.payload.text.match(/^#+\s+(.+)$/m)?.[1]?.trim();
  if (!title || title.length < 2) throw new ApiError(422, "no_title", "No title was extracted. Enter a query manually.");
  return { query: title.slice(0, 300), source: "inferred", rationale: "Suggested from the title TinyFish Fetch extracted. Edit it to match your intended audience's search.", model: null };
});
