import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroRibbon } from "@/components/HeroRibbon";
import { Logo } from "@/components/brand/Logo";
import { SeverityBadge, CheckBadge, DemoBadge } from "@/components/ui";

const STEPS = [
  { n: "01", t: "Search", d: "TinyFish Search runs your target query and records which results come back, in what order, with which titles and snippets." },
  { n: "02", t: "Fetch", d: "TinyFish Fetch retrieves the live page and returns what a retrieval pipeline can extract: text, headings, metadata, links." },
  { n: "03", t: "Verify", d: "Only when the evidence disagrees or Fetch comes back empty, TinyFish Browser renders the page to check what is really there." },
  { n: "04", t: "Diagnose", d: "Deterministic checks and a Gemini reading of the evidence produce prioritized findings, each linked to the record that supports it." },
];

export default function Landing() {
  return (
    <>
      <div className="on-dark bg-canvas-dark text-white">
        <header className="mx-auto flex max-w-[1280px] items-center justify-between px-4 py-5 sm:px-8">
          <Link href="/" aria-label="Sniffsite home"><Logo tone="dark" size={30} /></Link>
          <nav aria-label="Primary" className="flex items-center gap-4 text-sm sm:gap-6">
            <a href="#how" className="hidden hover:underline sm:inline">How it works</a>
            <Link href="/demo" className="hover:underline">Demo reports</Link>
            <Link href="/setup" className="hover:underline">Setup</Link>
            <Link href="/audit/new" className="btn btn-ghost-dark btn-sm">Sign in</Link>
          </nav>
        </header>

        <section id="main" className="mx-auto grid max-w-[1280px] items-center gap-10 px-4 pb-20 pt-10 sm:px-8 md:grid-cols-2 md:pb-24 md:pt-16">
          <div>
            <p className="eyebrow">AI search visibility auditor</p>
            <h1 className="t-display-xxl mt-4">Your website has a scent. Can AI find it?</h1>
            <p className="t-body-lg mt-4 max-w-xl text-on-dark-muted">
              Sniffsite finds the gap between what your page says, what an AI retrieval tool can extract from it, and what search results reveal. Every finding points to the evidence behind it.
            </p>
            <form action="/audit/new" method="get" className="mt-8 max-w-xl space-y-3" aria-label="Start an audit">
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
          <HeroRibbon className="order-first mx-auto w-full max-w-[560px] md:order-none" />
        </section>
      </div>

      <main>
        <section className="mx-auto max-w-[1280px] px-4 py-16 sm:px-8 md:py-20">
          <p className="eyebrow">The problem</p>
          <h2 className="t-display-xl mt-3 max-w-3xl">A page can be readable and still not be found, or found and still be misread.</h2>
          <p className="t-body-lg mt-4 max-w-3xl text-muted">
            Three different views of one page rarely agree: the copy you wrote, the text an extraction pipeline gets, and the snippet a search result shows. Sniffsite collects each view from real tools and shows exactly where they diverge.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              ["What your page says", "The messaging you intend: who it is for, what it offers, what it costs."],
              ["What AI tools can extract", "The title, headings, text, metadata and links a retrieval tool actually receives from the live page."],
              ["What search results reveal", "Whether the page appears for the query, where, and how its title and snippet compare to competing pages."],
            ].map(([t, d]) => (
              <div key={t} className="card p-6">
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
              {STEPS.map((s) => (
                <li key={s.n} className="card-dark p-6">
                  <p className="eyebrow">Step {s.n}</p>
                  <h3 className="t-display-md mt-3">{s.t}</h3>
                  <p className="mt-2 text-on-dark-muted">{s.d}</p>
                </li>
              ))}
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

        <section className="border-y border-hairline bg-[#fafafa]">
          <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-8">
            <p className="eyebrow">What the results mean</p>
            <p className="mt-2 max-w-4xl text-[#333]">
              Results describe <strong className="font-medium">sampled retrieval evidence</strong>: one search request and one fetch at a point in time, from TinyFish’s network. They are not guaranteed universal AI rankings, Google rankings, or a statement about every crawler.
            </p>
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
        <p aria-hidden="true" className="select-none whitespace-nowrap text-center font-medium leading-none text-hairline" style={{ fontSize: "clamp(64px, 19vw, 280px)", letterSpacing: "-0.05em" }}>
          sniffsite
        </p>
      </footer>
    </>
  );
}
