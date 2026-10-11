import { after } from "next/server";
import { z } from "zod";
import { ApiError, route } from "@/lib/api";
import { CreateAuditSchema, createAuditFromInput } from "@/lib/audit/create";
import { runAudit } from "@/lib/audit/orchestrator";
import { credentialStatus } from "@/lib/config";
import { listAudits } from "@/lib/db/repo";

// The audit runs inside `after()` on this invocation and persists state after every stage,
// so progress is read from MongoDB, not from process memory. 300s is the Vercel Pro ceiling;
// see docs/DEPLOYMENT.md for Hobby-plan limits.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const ListSchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(["queued", "running", "completed", "partial", "failed", "cancelled", "waiting_config"]).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  sort: z.enum(["newest", "oldest"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = route({}, async ({ user, req }) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = ListSchema.safeParse(sp);
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid filter parameters.");
  return listAudits(user.userId, parsed.data);
});

export const POST = route({ rate: [10, 60_000], schema: CreateAuditSchema }, async ({ user, body }) => {
  const tf = await credentialStatus(user.userId, "tinyfish");
  if (!tf.configured) throw new ApiError(409, "integration_missing", "TinyFish is not configured for your account. Add your API key on the Setup page before running a live audit.");
  const audit = await createAuditFromInput(body, user.userId);
  after(() => runAudit(audit.auditId));
  return { auditId: audit.auditId, status: audit.status };
});
