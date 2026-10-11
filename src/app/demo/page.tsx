import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { DemoBadge } from "@/components/ui";
import { DEMO_SLUGS, getDemoReport } from "@/lib/demo/reports";

export const metadata = { title: "Demo reports" };

export default function DemoIndex() {
  return (
    <>
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-4 py-4 sm:px-8">
          <Link href="/" aria-label="Sniffsite home"><Logo size={26} /></Link>
          <nav className="flex items-center gap-4 text-sm"><Link href="/setup" className="hover:underline">Setup</Link><Link href="/audit/new" className="btn btn-primary btn-sm">Run an audit</Link></nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1100px] px-4 py-10 sm:px-8">
        <DemoBadge />
        <h1 className="t-display-xl mt-3">Explore sample reports</h1>
        <p className="t-body-lg mt-3 max-w-3xl text-muted">Three fictional pages, analysed by the same engine that powers live audits. They are clearly labelled demos, were not produced by live TinyFish or Gemini calls, and never mix into real audits. No credentials needed.</p>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {DEMO_SLUGS.map((d) => {
            const r = getDemoReport(d.slug)!;
            return (
              <li key={d.slug} className="card flex flex-col p-6">
                <p className="eyebrow">{d.kind}</p>
                <h2 className="t-display-md mt-2">{d.label}</h2>
                <p className="mt-2 flex-1 text-muted">{d.blurb}</p>
                <p className="mono-label mt-4 text-muted">Query: “{d.query}” · {r.findings.length} findings · {r.audit.summary?.search === "found" ? `found at #${r.audit.summary.searchPosition}` : "not found in checked results"}</p>
                <Link href={`/demo/${d.slug}`} className="btn btn-primary mt-4">Open report</Link>
              </li>
            );
          })}
        </ul>
        <p className="mt-8 text-sm text-muted">Ready for the real thing? <Link href="/setup" className="underline">Configure integrations</Link> and run a live audit.</p>
      </main>
    </>
  );
}
