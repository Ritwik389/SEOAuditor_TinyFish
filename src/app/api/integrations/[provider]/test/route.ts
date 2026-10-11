import { z } from "zod";
import { ApiError, route } from "@/lib/api";
import { getCredential, getSettings } from "@/lib/config";
import { testMongo, storeMode } from "@/lib/db/mongo";
import { recordTest } from "@/lib/db/repo";
import { testGemini } from "@/lib/gemini/provider";
import { testTinyFishOperation, type TfOperation } from "@/lib/tinyfish/test";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const Body = z.object({ operations: z.array(z.enum(["search", "fetch", "browser"])).max(3).optional() });

async function save(userId: string, provider: string, op: string, r: { ok: boolean; message: string; httpStatus?: number; latencyMs?: number }) {
  if (storeMode() === "none") return;
  try {
    await recordTest(userId, provider, op, r);
  } catch {
    /* test results are best-effort metadata */
  }
}

/** Every operation performs a real request. Nothing is ever reported as passing without one. */
export const POST = route({ rate: [12, 60_000], schema: Body }, async ({ user, params, body }) => {
  const provider = params.provider;
  if (provider === "mongodb") {
    const r = await testMongo();
    if (r.ok) await save(user.userId, "mongodb", "readwrite", { ok: true, message: r.message, latencyMs: r.latencyMs });
    return { provider, results: [{ operation: "readwrite", ok: r.ok, message: r.message, latencyMs: r.latencyMs, stage: r.stage }] };
  }
  if (provider === "tinyfish") {
    const key = await getCredential(user.userId, "tinyfish");
    if (!key) throw new ApiError(409, "integration_missing", "You have not added a TinyFish API key yet.");
    // Browser is opt-in: it creates a real (billable) session.
    const ops: TfOperation[] = body.operations?.length ? body.operations : ["search", "fetch"];
    const results = [];
    for (const op of ops) {
      const r = await testTinyFishOperation(key, op);
      await save(user.userId, "tinyfish", op, r);
      results.push(r);
    }
    return { provider, results };
  }
  if (provider === "gemini") {
    const key = await getCredential(user.userId, "gemini");
    if (!key) throw new ApiError(409, "integration_missing", "You have not added a Gemini API key yet.");
    const model = (await getSettings(user.userId)).geminiModel;
    const r = await testGemini(key, model);
    await save(user.userId, "gemini", "connection", { ok: r.ok, message: r.message });
    return { provider, results: [{ operation: "connection", ok: r.ok, message: r.message, steps: r.steps }] };
  }
  throw new ApiError(404, "unknown_provider", "Unknown provider.");
});
