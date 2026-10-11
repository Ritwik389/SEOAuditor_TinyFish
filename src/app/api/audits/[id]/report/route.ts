import { ApiError, route } from "@/lib/api";
import { reconcileStale } from "@/lib/audit/orchestrator";
import { getAudit, listEvidence, listFindings } from "@/lib/db/repo";
import type { ReportData } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ user, params }) => {
  const a = await getAudit(params.id!, user.userId);
  if (!a) throw new ApiError(404, "not_found", "Audit not found.");
  const report: ReportData = { audit: await reconcileStale(a), evidence: await listEvidence(a.auditId), findings: await listFindings(a.auditId) };
  return report;
});
