import { ApiError, route } from "@/lib/api";
import { reconcileStale } from "@/lib/audit/orchestrator";
import { getAudit, listEvidence } from "@/lib/db/repo";
import { evidenceBrief } from "@/lib/report";

export const dynamic = "force-dynamic";

/**
 * Job-status polling endpoint. Everything returned is read from persisted audit state
 * (never process memory), so it works across serverless instances and after restarts.
 */
export const GET = route({ rate: [240, 60_000] }, async ({ user, req, params }) => {
  const a0 = await getAudit(params.id!, user.userId);
  if (!a0) throw new ApiError(404, "not_found", "Audit not found.");
  const a = await reconcileStale(a0);
  const since = Math.max(0, Number(new URL(req.url).searchParams.get("since")) || 0);
  const evidence = (await listEvidence(a.auditId)).map((e) => ({ evidenceId: e.evidenceId, sourceType: e.sourceType, label: e.label, capturedAt: e.capturedAt, brief: evidenceBrief(e), retrieval: e.retrieval }));
  return {
    auditId: a.auditId,
    status: a.status,
    currentStage: a.currentStage ?? null,
    cancelRequested: a.cancelRequested,
    startedAt: a.startedAt ?? null,
    completedAt: a.completedAt ?? null,
    updatedAt: a.updatedAt,
    stages: a.stages,
    log: a.log.slice(since),
    logTotal: a.log.length,
    evidence,
    summary: a.summary ?? null,
    errorSummary: a.errorSummary ?? null,
  };
});
