import { ApiError, route } from "@/lib/api";
import { reconcileStale } from "@/lib/audit/orchestrator";
import { deleteAudit, getAudit } from "@/lib/db/repo";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ user, params }) => {
  const a = await getAudit(params.id!, user.userId);
  if (!a) throw new ApiError(404, "not_found", "Audit not found.");
  return { audit: await reconcileStale(a) };
});

export const DELETE = route({ rate: [20, 60_000] }, async ({ user, params }) => {
  const a = await getAudit(params.id!, user.userId);
  if (!a) throw new ApiError(404, "not_found", "Audit not found.");
  if (a.status === "running" || a.status === "queued") throw new ApiError(409, "audit_active", "Cancel the audit before deleting it.");
  await deleteAudit(params.id!, user.userId);
  return { deleted: true };
});
