import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/ReportActions";
import { ReportView } from "@/components/report/ReportView";
import { reconcileStale } from "@/lib/audit/orchestrator";
import { getAudit, listEvidence, listFindings } from "@/lib/db/repo";
import { requireUser } from "@/lib/security/auth";
import { publicDemoEnabled } from "@/lib/public-demo";
import { PublicAuditView } from "@/components/PublicWorkspace";

export const metadata = { title: "Report" };
export const dynamic = "force-dynamic";

/** Clean, print-first report. Reads only saved evidence: no external API is called to render it. */
export default async function PrintReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (publicDemoEnabled()) return <main id="main" className="mx-auto max-w-[900px] px-4 py-8"><PublicAuditView id={id} print /></main>;
  const user = await requireUser(`/audit/${id}/report`);
  const audit = await getAudit(id, user.userId);
  if (!audit) notFound();
  const [evidence, findings] = await Promise.all([listEvidence(id), listFindings(id)]);
  return (
    <main id="main" className="mx-auto max-w-[900px] px-4 py-8">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/audit/${id}`} className="text-sm text-muted underline">← Interactive report</Link>
        <PrintButton />
      </div>
      <ReportView report={{ audit: await reconcileStale(audit), evidence, findings }} print />
    </main>
  );
}
