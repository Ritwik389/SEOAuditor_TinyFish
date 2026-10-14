import { after } from "next/server";
import { ApiError, route } from "@/lib/api";
import { createAuditFromInput } from "@/lib/audit/create";
import { runAudit } from "@/lib/audit/orchestrator";
import { credentialStatus } from "@/lib/config";
import { getAudit } from "@/lib/db/repo";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Creates a NEW audit with the same inputs (history of the old one is preserved). */
export const POST = route({ rate: [10, 60_000] }, async ({ user, params }) => {
  const a = await getAudit(params.id!, user.userId);
  if (!a) throw new ApiError(404, "not_found", "Audit not found.");
  if (a.status === "running" || a.status === "queued") throw new ApiError(409, "audit_active", "This audit is still active.");
  if (!(await credentialStatus(user.userId, "tinyfish")).configured) throw new ApiError(409, "integration_missing", "TinyFish is not configured for your account.");
  const next = await createAuditFromInput({ url: a.targetUrl, label: a.label, queries: a.queries, location: a.settings.location, language: a.settings.language, verification: a.settings.verification, agentVerification: a.settings.agentVerification ?? false }, user.userId, a.auditId);
  after(() => runAudit(next.auditId));
  return { auditId: next.auditId };
});
