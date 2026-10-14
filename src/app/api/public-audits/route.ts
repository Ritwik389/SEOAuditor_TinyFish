import { ApiError, route } from "@/lib/api";
import { CreateAuditSchema, createAuditFromInput } from "@/lib/audit/create";
import { runAudit } from "@/lib/audit/orchestrator";
import { withDemoDb } from "@/lib/db/demo-context";
import { getAudit, listEvidence, listFindings, patchAudit } from "@/lib/db/repo";
import { demoUser, publicDemoEnabled, publicDeps, publicServiceStatus } from "@/lib/public-demo";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = route({ auth: false, rate: [6, 60000], schema: CreateAuditSchema }, async ({ body, req }) => {
  if (!publicDemoEnabled()) throw new ApiError(404, "not_found", "Public audits are unavailable.");
  if (!publicServiceStatus().tinyfish) throw new ApiError(503, "integration_missing", "The demo's TinyFish key is not configured on the server.");
  return withDemoDb(async () => {
    const audit = await createAuditFromInput(body, demoUser.userId);
    const ctl = new AbortController();
    let timedOut = false;
    const encoder = new TextEncoder();
    const abort = () => ctl.abort();
    req.signal.addEventListener("abort", abort, { once: true });
    if (req.signal.aborted) abort();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); }
          catch { closed = true; ctl.abort(); }
        };
        const snapshot = async (type = "snapshot") => {
          const [current, evidence, findings] = await Promise.all([getAudit(audit.auditId, null), listEvidence(audit.auditId), listFindings(audit.auditId)]);
          if (current) send({ type, report: { audit: current, evidence, findings } });
        };
        send({ type: "snapshot", report: { audit, evidence: [], findings: [] } });
        const heartbeat = setInterval(() => send({ type: "heartbeat" }), 10000);
        const deadline = setTimeout(() => { timedOut = true; ctl.abort(); }, 270000);
        // The stream keeps the function alive for the actual work; no background
        // fire-and-forget job or cross-instance memory is required.
        void runAudit(audit.auditId, { ...publicDeps(), signal: ctl.signal, onUpdate: snapshot })
          .then(async () => {
            if (timedOut) await patchAudit(audit.auditId, { errorSummary: "The demo time limit was reached. Collected evidence is preserved. Retry with Browser and Agent off for a shorter audit." });
            await snapshot("complete");
          })
          .catch(() => send({ type: "error", message: "The audit stream stopped unexpectedly. Retry the audit." }))
          .finally(() => {
            clearInterval(heartbeat);
            clearTimeout(deadline);
            req.signal.removeEventListener("abort", abort);
            if (!closed) { closed = true; controller.close(); }
          });
      },
      cancel() { closed = true; ctl.abort(); },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store, no-transform", "x-content-type-options": "nosniff" } });
  });
});
