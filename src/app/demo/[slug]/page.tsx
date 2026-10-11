import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { ReportView } from "@/components/report/ReportView";
import { DEMO_SLUGS, getDemoReport } from "@/lib/demo/reports";

export function generateStaticParams() {
  return DEMO_SLUGS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const r = getDemoReport((await params).slug);
  return { title: r ? `Demo: ${r.audit.label}` : "Demo" };
}

export default async function DemoReport({ params }: { params: Promise<{ slug: string }> }) {
  const report = getDemoReport((await params).slug);
  if (!report) notFound();
  return (
    <>
      <header className="no-print border-b border-hairline">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-4 py-4 sm:px-8">
          <Link href="/" aria-label="Sniffsite home"><Logo size={26} /></Link>
          <nav className="flex items-center gap-4 text-sm"><Link href="/demo" className="hover:underline">All demos</Link><Link href="/setup" className="btn btn-primary btn-sm">Configure integrations</Link></nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1280px] px-4 py-8 sm:px-8"><ReportView report={report} /></main>
    </>
  );
}
