import { z } from "zod";
import { createAudit } from "../db/repo";
import { validateTargetUrl } from "../security/ssrf";
import { normalizeUrl } from "../url";
import { SCHEMA_VERSION, type AuditDoc } from "../types";
import { initialStages, newAuditId } from "./orchestrator";

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const CreateAuditSchema = z.object({
  url: z.string().trim().min(1, "Enter the page URL").max(2048),
  label: z.preprocess(emptyToUndef, z.string().trim().max(80).optional()),
  queries: z
    .array(
      z.object({
        text: z.string().trim().min(2, "Queries need at least 2 characters").max(300),
        source: z.enum(["user", "inferred"]),
        rationale: z.string().max(400).optional(),
      }),
    )
    .max(3, "At most 3 queries per audit")
    .default([]),
  location: z.preprocess(emptyToUndef, z.string().trim().regex(/^[A-Za-z]{2}$/, "Use a 2-letter country code").transform((s) => s.toUpperCase()).optional()),
  language: z.preprocess(emptyToUndef, z.string().trim().regex(/^[A-Za-z]{2,3}$/, "Use a 2-3 letter language code").transform((s) => s.toLowerCase()).optional()),
  verification: z.enum(["off", "auto", "always"]).default("auto"),
  agentVerification: z.boolean().default(false),
});
export type CreateAuditInput = Omit<z.infer<typeof CreateAuditSchema>, "agentVerification"> & { agentVerification?: boolean };

export async function createAuditFromInput(input: CreateAuditInput, ownerId: string, retryOf?: string): Promise<AuditDoc> {
  const u = await validateTargetUrl(input.url); // structural + DNS/private-range checks
  const now = new Date().toISOString();
  // Deduplicate queries, case-insensitively, so one query is never billed twice.
  const seen = new Set<string>();
  const queries = input.queries.filter((q) => !seen.has(q.text.toLowerCase()) && !!seen.add(q.text.toLowerCase()));
  const audit: AuditDoc = {
    auditId: newAuditId(),
    ownerId,
    schemaVersion: SCHEMA_VERSION,
    label: input.label,
    targetUrl: u.toString(),
    normalizedTargetUrl: normalizeUrl(u.toString()),
    queries,
    settings: { location: input.location, language: input.language, verification: input.verification, agentVerification: input.agentVerification ?? false },
    status: "queued",
    cancelRequested: false,
    createdAt: now,
    updatedAt: now,
    stages: initialStages(),
    log: [{ t: now, stageId: "audit", level: "info", message: retryOf ? `Audit queued (retry of ${retryOf}).` : "Audit queued." }],
    retryOf,
  };
  await createAudit(audit);
  return audit;
}
