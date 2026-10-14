import Link from "next/link";
import { ArrowRight, Code2, FileSearch, MonitorCheck, Search, Stethoscope } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { SITE_DESC, SITE_URL } from "@/lib/site";
import { SeverityBadge, CheckBadge, DemoBadge } from "@/components/ui";
import { STAGES } from "@/lib/types";
import { publicDemoEnabled } from "@/lib/public-demo";

const FAQ = [
  ["What does SEOAuditor audit?", "A single page and the search query it should be found for. SEOAuditor compares what the page says, what an AI retrieval tool can extract from it, and what search results show, then reports the gaps as prioritized, evidence-linked findings."],
  ["Is this a rank tracker?", "No. Results describe sampled retrieval evidence: one search and one fetch at a point in time. They are not guaranteed Google rankings or a statement about every crawler."],
  ["Does it replace a technical SEO audit?", "It covers the technical signals that affect retrieval, such as metadata, headings, robots.txt, sitemaps and rendering differences, but focuses on how AI tools and search results see the page."],
  ["Do I need API keys?", publicDemoEnabled() ? "No. The live demo uses server-held API keys. No account is needed, and your reports are saved in this browser." : "Live audits use your own TinyFish key, and optionally a Gemini key, added on the Setup page and stored encrypted. Sample reports need no keys."],
] as const;
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "SoftwareApplication", name: "SEOAuditor", applicationCategory: "BusinessApplication", operatingSystem: "Web", description: SITE_DESC, url: SITE_URL },
    { "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ],
};
const ICONS = [Search, FileSearch, MonitorCheck, Stethoscope];
const STATS = [
  ["4", "TinyFish endpoints in a deep audit", "bg-mint"],
  [String(STAGES.length), "audit stages, each with a visible state", "bg-periwinkle"],
  ["100%", "of findings linked to their evidence", "bg-mint"],
];
const STEPS = [
  { n: "01", t: "Search", d: "TinyFish Search runs your target query and records which results come back, in what order, with which titles and snippets." },
  { n: "02", t: "Fetch", d: "TinyFish Fetch retrieves the live page and returns what a retrieval pipeline can extract: text, headings, metadata, links." },
  { n: "03", t: "Verify", d: "Only when the evidence disagrees or Fetch comes back empty, TinyFish Browser renders the page to check what is really there." },
  { n: "04", t: "Diagnose", d: "Deterministic checks and a Gemini reading of the evidence produce prioritized findings, each linked to the record that supports it." },
];

export default function Landing() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\u003c") }} />
      <div className="on-dark bg-canvas-dark text-white">
        <header className="mx-auto flex max-w-[1280px] items-center justify-between px-4 py-5 sm:px-8">
          <Link href="/" aria-label="SEOAuditor home"><Logo tone="dark" size={30} /></Link>
          <nav aria-label="Primary" className="flex items-center gap-4 text-sm sm:gap-6">
            <a href="#how" className="hidden hover:underline sm:inline">How it works</a>
            <Link href="/demo" className="hover:underline">Demo reports</Link>
            <Link href="/setup" className="hover:underline">{publicDemoEnabled() ? "Integrations" : "Setup"}</Link>
            <Link href="/audit/new" className="btn btn-ghost-dark btn-sm">Run an audit</Link>
          </nav>
        </header>

        <section id="main" className="mx-auto grid max-w-[1280px] items-center gap-10 px-4 pb-20 pt-10 sm:px-8 md:grid-cols-2 md:pb-24 md:pt-16">
          <div>
            <p className="eyebrow rise">AI search visibility auditor</p>
            <h1 className="t-display-xxl rise rise-2 mt-4">Can AI read and find your page?</h1>
            <p className="t-body-lg rise rise-3 mt-4 max-w-xl text-on-dark-muted">
              SEOAuditor finds the gap between what your page says, what an AI retrieval tool can extract from it, and what search results reveal. Every finding points to the evidence behind it.
            </p>
            <form action="/audit/new" method="get" className="rise rise-4 mt-8 max-w-xl space-y-3" aria-label="Start an audit">
              <div>
                <label htmlFor="hero-url" className="eyebrow">Page URL</label>
                <input id="hero-url" name="url" type="url" required placeholder="https://example.com/pricing" className="input mt-1 border-dark-soft bg-dark-soft text-white placeholder:text-[#9a9ab4]" />
              </div>
              <div>
                <label htmlFor="hero-q" className="eyebrow">Search query <span className="normal-case tracking-normal">(optional)</span></label>
                <input id="hero-q" name="query" type="text" maxLength={300} placeholder="the query this page should be found for" className="input mt-1 border-dark-soft bg-dark-soft text-white placeholder:text-[#9a9ab4]" />
              </div>
              <div className="flex flex-wrap gap-3 pt-1">
                <button type="submit" className="btn btn-mint">Run an audit <ArrowRight size={16} aria-hidden /></button>
                <Link href="/demo" className="btn btn-ghost-dark">Explore sample report</Link>
              </div>
            </form>
          </div>
          <div className="order-first mx-auto w-full max-w-[560px] md:order-none">
            <div className="card-dark rise rise-4 mt-2 space-y-2 p-4 text-sm" role="img" aria-label="Example: three views of one page disagree">
              <p className="eyebrow">Sample scan · pricing page</p>
              {[
                ["Search", "found at #4", "text-mint"],
                ["Fetch", "212 words extracted", "text-mint"],
                ["Browser", "3 headings missing from Fetch", "text-[#ffb08a]"],
              ].map(([k, v, c]) => (
                <p key={k} className="flex items-center justify-between gap-3 border-t border-dark-soft pt-2 first-of-type:border-0"><span className="mono-label text-on-dark-muted">{k}</span><span className={c}>{v}</span></p>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="border-t border-hairline" aria-hidden="true" />
      <main>
        <section className="mx-auto max-w-[1280px] px-4 pt-12 sm:px-8">
          <ul className="grid gap-4 md:grid-cols-3">
            {STATS.map(([n, l, bg]) => (
              <li key={l} className={`${bg} rounded-sm p-8`}>
                <p className="t-display-lg" style={{ fontSize: 44 }}>{n}</p>
                <p className="mt-1 text-[#333]">{l}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto max-w-[1280px] px-4 py-16 sm:px-8 md:py-20">
          <p className="eyebrow">The problem</p>
          <h2 className="t-display-xl mt-3 max-w-3xl">A page can be readable and still not be found, or found and still be misread.</h2>
          <p className="t-body-lg mt-4 max-w-3xl text-muted">
            Three different views of one page rarely agree: the copy you wrote, the text an extraction pipeline gets, and the snippet a search result shows. SEOAuditor collects each view from real tools and shows exactly where they diverge.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              ["What your page says", "The messaging you intend: who it is for, what it offers, what it costs."],
              ["What AI tools can extract", "The title, headings, text, metadata and links a retrieval tool actually receives from the live page."],
              ["What search results reveal", "Whether the page appears for the query, where, and how its title and snippet compare to competing pages."],
            ].map(([t, d]) => (
              <div key={t} className="card lift p-6">
                <h3 className="t-display-md">{t}</h3>
                <p className="mt-2 text-muted">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="bg-canvas-dark py-16 text-white on-dark md:py-20">
          <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
            <p className="eyebrow">How it works</p>
            <h2 className="t-display-xl mt-3">Search, Fetch, Verify, Diagnose.</h2>
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => {
                const Icon = ICONS[i]!;
                return (
                <li key={s.n} className="card-dark lift p-6">
                  <div className="flex items-center justify-between"><p className="eyebrow">Step {s.n}</p><Icon size={20} className="text-periwinkle" aria-hidden /></div>
                  <h3 className="t-display-md mt-3">{s.t}</h3>
                  <p className="mt-2 text-on-dark-muted">{s.d}</p>
                </li>
                );
              })}
            </ol>
            <p className="mt-6 max-w-3xl text-sm text-on-dark-muted">Each endpoint has a different job. Browser is not run for decoration: it only runs when there is a concrete question to answer or you turn verification on.</p>
          </div>
        </section>

        <section className="mx-auto max-w-[1280px] px-4 py-16 sm:px-8 md:py-20">
          <div className="grid items-start gap-10 md:grid-cols-2">
            <div>
              <p className="eyebrow">Evidence-backed findings</p>
              <h2 className="t-display-xl mt-3">Every finding shows its receipts.</h2>
              <p className="t-body-lg mt-4 text-muted">
                Findings carry a severity, a confidence that reflects evidence quality rather than rhetoric, the exact excerpt that triggered them, and a fix you can apply. Open the evidence inspector to see which endpoint produced the record, what was requested, and what the tool did not tell us.
              </p>
              <ul className="mt-6 space-y-2 text-muted">
                <li>Deterministic checks are separate from AI interpretation, and labelled as such.</li>
                <li>Anything not observed is shown as “Not checked”, never as a pass.</li>
                <li>A page missing from a result sample is “Not found in checked results”, never “not indexed”.</li>
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/demo" className="btn btn-primary">Explore sample report</Link>
                <Link href="/setup" className="btn btn-outline">Configure integrations</Link>
              </div>
            </div>
            <figure className="card overflow-hidden" aria-label="Example finding (demo data)">
              <div className="flex items-center justify-between border-b border-hairline bg-hairline px-4 py-2.5">
                <span className="eyebrow">Example finding</span>
                <DemoBadge />
              </div>
              <div className="space-y-3 p-5">
                <div className="flex flex-wrap items-center gap-2"><SeverityBadge s="high" /><span className="badge bg-canvas">Confidence: high</span></div>
                <h3 className="t-display-md">Rendered page headings are missing from Fetch’s extraction</h3>
                <p className="text-sm text-muted">Browser rendered 3 headings that do not appear in the Fetch text.</p>
                <blockquote className="prose-evidence rounded-sm border border-hairline bg-[#fafafa] p-3">Customer reviews | Size &amp; fit | Shipping and returns</blockquote>
                <p className="mono-label text-muted">Evidence: ev_fetch_1 · ev_browser_1</p>
                <div className="flex flex-wrap gap-2"><CheckBadge s="pass" /><CheckBadge s="warning" /><CheckBadge s="not_checked" /></div>
              </div>
            </figure>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-[1280px] px-4 py-16 sm:px-8 md:py-20">
          <p className="eyebrow">FAQ</p>
          <h2 className="t-display-xl mt-3">Questions about AI search visibility audits</h2>
          <dl className="mt-8 grid gap-4 md:grid-cols-2">
            {FAQ.map(([q, a]) => (
              <div key={q} className="card p-6">
                <dt className="t-display-md">{q}</dt>
                <dd className="mt-2 text-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-y border-hairline bg-[#fafafa]">
          <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-8">
            <p className="eyebrow">What the results mean</p>
            <p className="mt-2 max-w-4xl text-[#333]">
              Results describe <strong className="font-medium">sampled retrieval evidence</strong>: one search request and one fetch at a point in time, from TinyFish’s network. They are not guaranteed universal AI rankings, Google rankings, or a statement about every crawler.
            </p>
          </div>
        </section>

        <section className="on-dark bg-canvas-dark text-white">
          <div className="mx-auto flex max-w-[1280px] flex-col items-start gap-6 px-4 py-16 sm:px-8 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="eyebrow flex items-center gap-2"><Code2 size={14} aria-hidden /> No guesswork</p>
              <h2 className="t-display-xl mt-3 max-w-2xl">Find out what AI sees on your page, in one audit.</h2>
            </div>
            <Link href="/audit/new" className="btn btn-mint">Run an audit <ArrowRight size={16} aria-hidden /></Link>
          </div>
        </section>
      </main>

      <footer className="overflow-hidden bg-canvas">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-4 py-10 sm:px-8">
          <Logo size={26} />
          <nav aria-label="Footer" className="flex flex-wrap gap-6 text-sm text-muted">
            <Link href="/demo" className="hover:text-ink">Demo reports</Link>
            <Link href="/setup" className="hover:text-ink">Setup &amp; integrations</Link>
            <Link href="/audit/new" className="hover:text-ink">Run an audit</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
