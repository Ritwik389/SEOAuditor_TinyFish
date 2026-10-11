import { ApiError, route } from "@/lib/api";
import { getAudit, patchAudit } from "@/lib/db/repo";

export const POST = route({ rate: [20, 60_000] }, async ({ user, params }) => {
  const a = await getAudit(params.id!, user.userId);
  if (!a) throw new ApiError(404, "not_found", "Audit not found.");
  if (a.status !== "running" && a.status !== "queued") throw new ApiError(409, "not_active", `Audit is already ${a.status}.`);
  // Persisted flag: the running invocation polls it and aborts in-flight requests (including the Browser session).
  await patchAudit(a.auditId, { cancelRequested: true });
  if (a.status === "queued") await patchAudit(a.auditId, { status: "cancelled", completedAt: new Date().toISOString() });
  return { cancelRequested: true };
});
