import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LiveAudit } from "@/components/LiveAudit";
import { ReportActions } from "@/components/ReportActions";
import { ReportView } from "@/components/report/ReportView";
import { reconcileStale } from "@/lib/audit/orchestrator";
import { getAudit, listEvidence, listFindings } from "@/lib/db/repo";
import { StoreNotConfigured } from "@/lib/db/mongo";
import { requireUser } from "@/lib/security/auth";
import { TERMINAL } from "@/lib/types";
import { EmptyState } from "@/components/ui";
import Link from "next/link";
import { demoUser, publicDemoEnabled } from "@/lib/public-demo";
import { PublicAuditView } from "@/components/PublicWorkspace";

export const metadata = { title: "Audit" };
export const dynamic = "force-dynamic";

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (publicDemoEnabled()) return <AppShell user={demoUser} publicDemo wide><PublicAuditView id={id} /></AppShell>;
  const user = await requireUser(`/audit/${id}`);
  let audit;
  try {
    audit = await getAudit(id, user.userId);
  } catch (e) {
    if (e instanceof StoreNotConfigured) {
      return <AppShell user={user}><EmptyState title="Database not configured" action={<Link href="/setup" className="btn btn-primary">Open setup</Link>}>Audits are stored in MongoDB. The administrator must set MONGODB_URI, then reload.</EmptyState></AppShell>;
    }
    throw e;
  }
  if (!audit) notFound();
  audit = await reconcileStale(audit);

  if (!TERMINAL.includes(audit.status)) {
    return <AppShell user={user}><LiveAudit initial={audit} /></AppShell>;
  }
  const [evidence, findings] = await Promise.all([listEvidence(id), listFindings(id)]);
  return (
    <AppShell user={user} wide>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/history" className="text-sm text-muted underline">← All audits</Link>
        <ReportActions audit={audit} reportHref={`/audit/${id}/report`} />
      </div>
      <ReportView report={{ audit, evidence, findings }} />
    </AppShell>
  );
}
