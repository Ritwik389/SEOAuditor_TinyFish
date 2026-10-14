import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { DemoBadge } from "@/components/ui";
import { DEMO_SLUGS, getDemoReport } from "@/lib/demo/reports";
import { LIVE_EXAMPLES, getLiveExample } from "@/lib/demo/live";

export const metadata = {
  title: "Sample AI search visibility reports",
  description: "Three sample audits showing how SEOAuditor compares a page's copy, its extracted text and its search results.",
  alternates: { canonical: "/demo" },
};

export default function DemoIndex() {
  return (
    <>
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-4 py-4 sm:px-8">
          <Link href="/" aria-label="SEOAuditor home"><Logo size={26} /></Link>
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
        <section className="mt-12 border-t border-hairline pt-8" aria-labelledby="live-examples-title">
          <p className="ui-badge badge">Real TinyFish evidence</p>
          <h2 id="live-examples-title" className="t-display-lg mt-3">Three real pages. Three different signals.</h2>
          <p className="mt-3 max-w-3xl text-muted">Live Search and Fetch captures from 14 October 2026, analysed by the same engine. These dated, bounded captures can be opened without credentials; each has a fresh-audit action.</p>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {LIVE_EXAMPLES.map((c) => {
              const r = getLiveExample(c.slug)!;
              return <li key={c.slug} className="ui-card card"><div className="ui-card-body p-6">
                <p className="eyebrow">{new URL(c.url).hostname}</p><h3 className="ui-card-title t-display-md">{c.title}</h3>
                <p className="mono-label text-muted">Query: “{c.query}”</p>
                <p className="mt-2 text-sm">{r.audit.summary?.search === "found" ? `Position #${r.audit.summary.searchPosition} in checked results` : "Absent from checked results"}</p>
                <div className="ui-card-actions mt-3"><Link href={`/examples/${c.slug}`} className="ui-btn btn btn-primary w-full">Open capture</Link></div>
              </div></li>;
            })}
          </ul>
        </section>
        <p className="mt-8 text-sm text-muted">Ready for a fresh audit? <Link href="/setup" className="underline">Configure integrations</Link> and audit any public URL.</p>
      </main>
    </>
  );
}
