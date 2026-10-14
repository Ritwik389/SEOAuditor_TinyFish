import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Clock3 } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { ReportView } from "@/components/report/ReportView";
import { LIVE_EXAMPLES, getLiveExample } from "@/lib/demo/live";

export function generateStaticParams() { return LIVE_EXAMPLES.map((c) => ({ slug: c.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const report = getLiveExample((await params).slug);
  return { title: report ? `Real-page capture: ${report.audit.label}` : "Real-page capture", robots: { index: false } };
}

export default async function LiveExamplePage({ params }: { params: Promise<{ slug: string }> }) {
  const report = getLiveExample((await params).slug);
  if (!report) notFound();
  const fresh = `/audit/new?${new URLSearchParams({ url: report.audit.targetUrl, query: report.audit.queries[0]!.text })}`;
  return <>
    <header className="no-print border-b border-hairline"><div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-4 py-4 sm:px-8">
      <Link href="/" aria-label="SEOAuditor home"><Logo size={26} /></Link><Link href="/demo" className="hover:underline">All examples</Link>
    </div></header>
    <main id="main" className="mx-auto max-w-[1280px] px-4 py-8 sm:px-8">
      <div className="ui-card card mb-8">
        <div className="ui-card-body gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-3xl"><p className="flex items-center gap-2 font-medium"><Clock3 size={17} aria-hidden /> Real page · dated evidence capture</p>
            <p className="mt-1 text-sm text-muted">Collected with live TinyFish Search and Fetch on {new Date(report.audit.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST. This view replays that capture. Longer pages retain a 2,400-character excerpt, so absence findings need a fresh check.</p>
          </div>
          <Link href={fresh} className="ui-btn btn btn-primary shrink-0">Audit this page now <ArrowRight size={16} aria-hidden /></Link>
        </div>
      </div>
      <ReportView report={report} />
    </main>
  </>;
}
