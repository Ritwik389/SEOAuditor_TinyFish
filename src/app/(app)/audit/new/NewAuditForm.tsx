"use client";

import { Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banner, cx } from "@/components/ui";

interface Q { text: string; source: "user" | "inferred"; rationale?: string }

export function NewAuditForm({ initialUrl, initialQuery, ready, missing, geminiConfigured, defaults }: {
  initialUrl: string; initialQuery: string; ready: boolean; missing: string[]; geminiConfigured: boolean;
  defaults: { verification: "off" | "auto" | "always"; location: string; language: string };
}) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [queries, setQueries] = useState<Q[]>([{ text: initialQuery, source: "user" }]);
  const [label, setLabel] = useState("");
  const [location, setLocation] = useState(defaults.location);
  const [language, setLanguage] = useState(defaults.language);
  const [verification, setVerification] = useState(defaults.verification);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [proposalNote, setProposalNote] = useState("");

  const setQ = (i: number, patch: Partial<Q>) => setQueries((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  async function propose() {
    setErrors({});
    setProposalNote("");
    if (!url.trim()) return setErrors({ url: "Enter the page URL first so the page can be read." });
    setProposing(true);
    const r = await fetch("/api/query-proposal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    const j = await r.json().catch(() => null);
    setProposing(false);
    if (!r.ok) return setProposalNote(j?.error?.message ?? "Could not propose a query.");
    setQ(0, { text: j.query, source: "inferred", rationale: j.rationale });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormErr("");
    const errs: Record<string, string> = {};
    if (!url.trim()) errs.url = "Enter the page URL.";
    else if (!/^https?:\/\//i.test(url.trim())) errs.url = "The URL must start with http:// or https://";
    if (location && !/^[A-Za-z]{2}$/.test(location)) errs.location = "Use a 2-letter country code, for example US.";
    if (language && !/^[A-Za-z]{2,3}$/.test(language)) errs.language = "Use a language code, for example en.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = { url: url.trim(), label, location, language, verification, queries: queries.filter((q) => q.text.trim()).map((q) => ({ text: q.text.trim(), source: q.source, rationale: q.rationale })) };
    const r = await fetch("/api/audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      setBusy(false);
      return setFormErr(j?.error?.message ?? "Could not start the audit.");
    }
    router.push(`/audit/${j.auditId}`);
  }

  const inferred = queries[0]?.source === "inferred";
  const hasQuery = queries.some((q) => q.text.trim());

  return (
    <form onSubmit={submit} noValidate className="grid gap-8 lg:grid-cols-[1fr_320px]" aria-describedby={formErr ? "form-err" : undefined}>
      <div className="space-y-6">
        {formErr ? <div id="form-err"><Banner tone="error" title="Audit not started">{formErr}</Banner></div> : null}

        <div>
          <label htmlFor="url" className="eyebrow">Target page URL <span aria-hidden>*</span></label>
          <input id="url" type="url" inputMode="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/pricing" className="input mt-1" aria-invalid={!!errors.url} aria-describedby={errors.url ? "url-err" : "url-hint"} />
          {errors.url ? <p id="url-err" role="alert" className="mt-1 text-sm text-crit">{errors.url}</p> : <p id="url-hint" className="mt-1 text-sm text-muted">Public http(s) pages only. Localhost and private networks are blocked.</p>}
        </div>

        <fieldset>
          <legend className="eyebrow">Target search query</legend>
          <div className="mt-1 flex gap-2">
            <input aria-label="Primary search query" value={queries[0]!.text} onChange={(e) => setQ(0, { text: e.target.value, source: "user", rationale: undefined })} placeholder="what someone would type to find this page" maxLength={300} className="input" aria-describedby="q-hint" />
            <button type="button" onClick={propose} disabled={proposing || !ready || !geminiConfigured} className="btn btn-outline shrink-0" title={geminiConfigured ? "Reads the page and suggests a query" : "Needs Gemini (see Setup)"}>
              <Sparkles size={15} aria-hidden /> {proposing ? "Reading…" : "Propose"}
            </button>
          </div>
          <p id="q-hint" className="mt-1 text-sm text-muted">
            {inferred ? null : hasQuery ? "Used exactly as typed." : "Optional. Without a query, Sniffsite runs a fetch-only audit and skips search."}
            {!geminiConfigured ? " Query proposals need Gemini; configure it on the Setup page." : ""}
          </p>
          {inferred ? (
            <div className="mt-2 rounded-sm border border-[#c9d3f5] bg-info-bg p-3 text-sm" role="status">
              <p><strong className="font-medium">Automatically generated query.</strong> Edit it to make it your own, or run the audit as is; the report will label it as inferred.</p>
              {queries[0]!.rationale ? <p className="mt-1 text-[#333]">Why: {queries[0]!.rationale}</p> : null}
            </div>
          ) : null}
          {proposalNote ? <p role="alert" className="mt-2 text-sm text-crit">{proposalNote}</p> : null}
        </fieldset>

        <details className="card group p-0" open={queries.length > 1 || undefined}>
          <summary className="flex min-h-11 cursor-pointer items-center justify-between px-4 py-3 text-[15px] font-medium">Advanced options</summary>
          <div className="space-y-5 border-t border-hairline p-4">
            <div>
              <p className="eyebrow">Additional queries (max 2)</p>
              <p className="mt-1 text-sm text-muted">Each extra query is one more Search request. They are stored and reported separately.</p>
              {queries.slice(1).map((q, i) => (
                <div key={i} className="mt-2 flex gap-2">
                  <input aria-label={`Additional query ${i + 1}`} value={q.text} onChange={(e) => setQ(i + 1, { text: e.target.value, source: "user" })} maxLength={300} className="input" />
                  <button type="button" className="btn btn-outline" aria-label={`Remove additional query ${i + 1}`} onClick={() => setQueries((qs) => qs.filter((_, j) => j !== i + 1))}><X size={16} aria-hidden /></button>
                </div>
              ))}
              {queries.length < 3 ? <button type="button" className="btn btn-outline btn-sm mt-2" onClick={() => setQueries((qs) => [...qs, { text: "", source: "user" }])}><Plus size={14} aria-hidden /> Add query</button> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="loc" className="eyebrow">Country (search region)</label>
                <input id="loc" value={location} onChange={(e) => setLocation(e.target.value.toUpperCase())} maxLength={2} placeholder="US" className="input mt-1" aria-invalid={!!errors.location} />
                {errors.location ? <p role="alert" className="mt-1 text-sm text-crit">{errors.location}</p> : null}
              </div>
              <div>
                <label htmlFor="lang" className="eyebrow">Language</label>
                <input id="lang" value={language} onChange={(e) => setLanguage(e.target.value.toLowerCase())} maxLength={3} placeholder="en" className="input mt-1" aria-invalid={!!errors.language} />
                {errors.language ? <p role="alert" className="mt-1 text-sm text-crit">{errors.language}</p> : null}
              </div>
            </div>
            <div>
              <label htmlFor="label" className="eyebrow">Audit label</label>
              <input id="label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Pricing page, Q4 launch" className="input mt-1" />
            </div>
          </div>
        </details>
      </div>

      <aside className="space-y-6">
        <fieldset className="card p-4">
          <legend className="eyebrow px-1">Browser verification</legend>
          {([
            ["auto", "Automatic", "Only when evidence is empty, thin or blocked."],
            ["always", "Always", "Render the page and compare it with the Fetch output."],
            ["off", "Off", "Search and Fetch only."],
          ] as const).map(([v, t, d]) => (
            <label key={v} className={cx("mt-2 flex min-h-11 cursor-pointer gap-3 rounded-sm border p-3", verification === v ? "border-ink" : "border-hairline")}>
              <input type="radio" name="verification" value={v} checked={verification === v} onChange={() => setVerification(v)} className="mt-1 accent-black" />
              <span><span className="block text-[15px] font-medium">{t}</span><span className="block text-sm text-muted">{d}</span></span>
            </label>
          ))}
          <p className="mt-3 text-sm text-muted">Browser sessions can consume TinyFish wallet credit.</p>
        </fieldset>
        <div className="card p-4 text-sm text-muted">
          <p className="font-medium text-ink">This audit will make at most</p>
          <ul className="mt-1 list-inside list-disc">
            <li>{queries.filter((q) => q.text.trim()).length} Search request(s)</li>
            <li>1 Fetch request</li>
            <li>{verification === "off" ? "0" : verification === "always" ? "1" : "0–1"} Browser session(s)</li>
            <li>{geminiConfigured ? "1 Gemini analysis (plus 1 repair retry if needed)" : "no Gemini analysis (not configured)"}</li>
          </ul>
        </div>
        <button className="btn btn-primary w-full" disabled={busy || !ready}>{busy ? "Starting…" : "Run an audit"}</button>
        {!ready ? <p className="text-sm text-muted">Disabled until setup is complete (missing: {missing.join(", ")}). <Link href="/setup" className="underline">Configure integrations</Link> or <Link href="/demo" className="underline">explore a sample report</Link>.</p> : null}
      </aside>
    </form>
  );
}
