"use client";

import { Check, ExternalLink, KeyRound, Lock, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { Banner, CheckBadge, cx, fmtDate } from "@/components/ui";
import type { IntegrationsStatus } from "@/lib/integrations";

type Tests = IntegrationsStatus["tinyfish"]["tests"];
interface OpResult { operation: string; ok: boolean; message: string; latencyMs?: number; steps?: { step: string; ok: boolean; message: string }[] }
interface Settings { geminiModel: string; defaultVerification: string; defaultLocation?: string; defaultLanguage?: string; retentionDays: number; maxEvidenceChars: number }

const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">{children}<ExternalLink size={12} aria-hidden /></a>
);

function Steps({ items }: { items: React.ReactNode[] }) {
  return <ol className="list-inside list-decimal space-y-1.5 text-[15px] text-[#333]">{items.map((s, i) => <li key={i}>{s}</li>)}</ol>;
}

function Step({ n, title, state, children }: { n: number; title: string; state: "done" | "todo" | "optional"; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className="card p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm", state === "done" ? "border-ink bg-ink text-white" : "border-[#bbb]")}>{state === "done" ? <Check size={16} aria-label="done" /> : n}</span>
        <h2 id={`step-${n}`} className="t-display-md">{title}</h2>
        {state === "optional" ? <span className="badge ml-auto">optional</span> : null}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function TestResults({ results, busy }: { results: OpResult[]; busy: boolean }) {
  return (
    <div aria-live="polite">
      {busy ? <p className="text-sm text-muted">Making a real request…</p> : null}
      {results.length ? (
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.operation} className={cx("rounded-sm border p-3 text-sm", r.ok ? "border-[#a6e1c0] bg-ok-bg" : "border-[#f4b3ad] bg-crit-bg")}>
              <p className="flex items-center gap-2 font-medium">{r.ok ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}<span className="capitalize">{r.operation}</span>: {r.ok ? "passed" : "failed"}{r.latencyMs ? <span className="mono-label font-normal text-muted"> · {r.latencyMs} ms</span> : null}</p>
              <p className="mt-1 text-[#333]">{r.message}</p>
              {r.steps ? <ul className="mt-1 list-inside list-disc">{r.steps.map((s) => <li key={s.step}>{s.step}: {s.ok ? "ok" : "failed"}. {s.message}</li>)}</ul> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LastTests({ tests }: { tests: Tests }) {
  const e = Object.entries(tests ?? {});
  if (!e.length) return <p className="text-sm text-muted">Never tested.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {e.map(([op, t]) => (
        <li key={op} className="flex flex-wrap items-center gap-2"><CheckBadge s={t.ok ? "pass" : "fail"} /><span className="capitalize">{op}</span><span className="text-muted">last tested {fmtDate(t.testedAt)}</span></li>
      ))}
    </ul>
  );
}

export function SetupWizard({ initial, models, initialSettings }: { initial: IntegrationsStatus; models: string[]; initialSettings: Settings }) {
  const [st, setSt] = useState(initial);
  const [settings, setSettings] = useState(initialSettings);
  const [busy, setBusy] = useState<string>("");
  const [res, setRes] = useState<Record<string, OpResult[]>>({});
  const [keys, setKeys] = useState({ tinyfish: "", gemini: "" });
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");

  async function refresh() {
    const r = await fetch("/api/integrations/status");
    if (r.ok) setSt(await r.json());
  }

  async function test(provider: string, operations?: string[]) {
    setBusy(`${provider}:${operations?.join(",") ?? "default"}`);
    const r = await fetch(`/api/integrations/${provider}/test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(operations ? { operations } : {}) });
    const j = await r.json().catch(() => null);
    setBusy("");
    const results: OpResult[] = r.ok ? j.results : [{ operation: "request", ok: false, message: j?.error?.message ?? "The test request failed." }];
    setRes((p) => ({ ...p, [provider]: [...results, ...(p[provider] ?? []).filter((o) => !results.some((n) => n.operation === o.operation))] }));
    await refresh();
  }

  async function configure(provider: "tinyfish" | "gemini", action: "save" | "remove") {
    setBusy(`cfg:${provider}`);
    setMsg((m) => ({ ...m, [provider]: { ok: true, text: "" } }));
    const r = await fetch("/api/integrations/configure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action === "save" ? { action, provider, apiKey: keys[provider] } : { action, provider }) });
    const j = await r.json().catch(() => null);
    setBusy("");
    if (!r.ok) return setMsg((m) => ({ ...m, [provider]: { ok: false, text: j?.error?.message ?? "Could not save." } }));
    setKeys((k) => ({ ...k, [provider]: "" })); // never keep the secret in client state
    setSt(j);
    setRes((p) => ({ ...p, [provider]: [] }));
    setMsg((m) => ({ ...m, [provider]: { ok: true, text: action === "save" ? "Saved encrypted on the server. Run the connection test next." : "Removed." } }));
  }

  async function patchSettings(p: Partial<Settings>) {
    const r = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
    const j = await r.json().catch(() => null);
    setMsg((m) => ({ ...m, settings: { ok: r.ok, text: r.ok ? "Settings saved." : j?.error?.message ?? "Could not save settings." } }));
    if (r.ok) setSettings(j.settings);
  }

  const mongoOk = st.mongodb.tests?.readwrite?.ok === true;
  const tfSearchOk = st.tinyfish.tests?.search?.ok === true;
  const tfFetchOk = st.tinyfish.tests?.fetch?.ok === true;
  const tfBrowserOk = st.tinyfish.tests?.browser?.ok === true;
  const gemOk = st.gemini.tests?.connection?.ok === true;
  const requiredOk = mongoOk && tfSearchOk && tfFetchOk;
  const canSave = st.storage.canSaveCredentials;
  const credUi = (p: "tinyfish" | "gemini", label: string) => {
    const s = st[p];
    return (
      <div className="rounded-sm border border-hairline p-4">
        <p className="eyebrow">Your {label} API key</p>
        <p className="mt-1 text-[15px]">
          {s.configured ? <><Lock size={14} className="mr-1 inline" aria-hidden /><strong className="font-medium">Saved, encrypted at rest</strong> ({s.hint}). It is used only for your audits and is never shown again.</> : "Not added yet."}
        </p>
        {!canSave ? <p role="alert" className="mt-2 rounded-sm border border-[#f0d58a] bg-med-bg p-2 text-sm text-[#333]">Saving will be refused until the server is fixed: {st.storage.reason}</p> : null}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label htmlFor={`${p}-key`} className="sr-only">{label} API key</label>
          <input id={`${p}-key`} type="password" autoComplete="off" spellCheck={false} placeholder={s.configured ? `Paste a new ${label} key to replace it` : `Paste your ${label} API key`} value={keys[p]} onChange={(e) => setKeys((k) => ({ ...k, [p]: e.target.value }))} className="input" />
          <button className="btn btn-primary shrink-0" disabled={keys[p].trim().length < 8 || busy === `cfg:${p}`} onClick={() => configure(p, "save")}><KeyRound size={14} aria-hidden /> {s.configured ? "Replace" : "Save securely"}</button>
          {s.configured ? <button className="btn btn-outline shrink-0" onClick={() => configure(p, "remove")}>Remove</button> : null}
        </div>
        {msg[p]?.text ? <p role={msg[p]!.ok ? "status" : "alert"} className={cx("mt-2 text-sm", msg[p]!.ok ? "text-ok" : "text-crit")}>{msg[p]!.text}</p> : null}
        <p className="mt-2 text-xs text-muted">Sent over HTTPS, encrypted with AES-256-GCM using a key kept outside the database and bound to your account, and never returned to the browser. Other users cannot read or use it.</p>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {requiredOk ? <Banner tone="ok" title="Required integrations verified" action={<Link href="/audit/new" className="btn btn-primary btn-sm">Run an audit</Link>}>Database and TinyFish Search + Fetch passed real tests.{!gemOk ? " Gemini is not verified: reports will contain deterministic findings only." : ""}</Banner> : <Banner tone="warn" title="Setup is not complete">Live audits need a working database and your TinyFish Search + Fetch tests to pass. Complete steps 2 and 3 below, or <Link href="/demo" className="underline">explore sample reports</Link>.</Banner>}

      <Step n={1} title="Welcome to Sniffsite" state="done">
        <div className="flex gap-4"><LogoMark size={40} className="shrink-0" />
          <p className="text-[15px] text-[#333]">Sniffsite runs a real search and a real fetch for your page, optionally verifies it in a browser, and then explains the gap between what your page says, what can be extracted, and what search shows. Gemini only interprets that evidence; it never replaces retrieval.</p></div>
      </Step>

      <Step n={2} title="Database" state={mongoOk ? "done" : "todo"}>
        <p className="text-sm"><span className="badge">Status</span> {st.storage.mode === "mongo" ? "Connected through the server configuration." : st.storage.mode === "memory" ? "In-memory TEST store (development only, not durable)." : "No database is configured on the server."}</p>
        <div className="flex flex-wrap items-center gap-3"><button className="btn btn-primary" disabled={!!busy} onClick={() => test("mongodb")}>{busy === "mongodb:default" ? "Testing…" : "Test connection"}</button></div>
        <TestResults results={res.mongodb ?? []} busy={busy === "mongodb:default"} />
        <LastTests tests={st.mongodb.tests} />
      </Step>

      <Step n={3} title="TinyFish: Search, Fetch and Browser" state={tfSearchOk && tfFetchOk ? "done" : "todo"}>
        <p className="text-[15px] text-[#333]">Three endpoints with different jobs. <strong className="font-medium">Search</strong> shows how your page appears for a query. <strong className="font-medium">Fetch</strong> shows what can be extracted from the live page. <strong className="font-medium">Browser</strong> verifies disputed findings in a rendered page. A passing key does not prove all three work, so each is tested separately.</p>
        {credUi("tinyfish", "TinyFish")}
        <details className="rounded-sm border border-hairline p-4"><summary className="cursor-pointer font-medium">How to get a TinyFish API key</summary>
          <div className="mt-3"><Steps items={[
            <>Read the <Ext href="https://docs.tinyfish.ai/">TinyFish developer docs</Ext> to see the Search, Fetch and Browser APIs.</>,
            <>Create or open your account and go to the <Ext href="https://agent.tinyfish.ai/api-keys">API keys page</Ext>.</>,
            "Click Create API Key. The key is shown only once, so copy it immediately.",
            "Paste it above. It is saved encrypted and only your account can use it.",
            "Run the tests below and check which operations show as available.",
          ]} />
            <p className="mt-3 text-sm text-muted">Per the docs, Search and Fetch are free within a daily allowance (about 12,000 searches and 1,000 URLs); Browser sessions draw from your wallet. Some operations can require an account entitlement: if a test reports “not enabled”, that is an account matter, not a Sniffsite bug.</p></div></details>
        <div className="grid gap-2 sm:grid-cols-3">
          {([["search", "Search", tfSearchOk, "Free daily allowance"], ["fetch", "Fetch", tfFetchOk, "Free daily allowance"], ["browser", "Browser", tfBrowserOk, "Creates a billable session"]] as const).map(([op, name, ok, note]) => (
            <div key={op} className="rounded-sm border border-hairline p-3">
              <p className="flex items-center justify-between font-medium">{name}<CheckBadge s={st.tinyfish.tests?.[op] ? (ok ? "pass" : "fail") : "not_checked"} /></p>
              <p className="mt-1 text-xs text-muted">{note}</p>
              <button className="btn btn-outline btn-sm mt-2 w-full" disabled={!st.tinyfish.configured || !!busy} onClick={() => test("tinyfish", [op])}>{busy === `tinyfish:${op}` ? "Testing…" : `Test ${name}`}</button>
            </div>
          ))}
        </div>
        <TestResults results={res.tinyfish ?? []} busy={busy.startsWith("tinyfish")} />
        <LastTests tests={st.tinyfish.tests} />
        {st.tinyfish.configured && !tfBrowserOk ? <p className="text-sm text-muted">Browser is optional. Without it, verification is reported as skipped or unavailable and audits still complete.</p> : null}
      </Step>

      <Step n={4} title="Gemini: evidence synthesis" state={gemOk ? "done" : "optional"}>
        <p className="text-[15px] text-[#333]">Gemini reads the evidence TinyFish returned and drafts interpretation and recommendations. It is not a substitute for retrieval and cannot invent results: its output is validated, and quotes that are not verbatim in the evidence are discarded. Without Gemini, audits still run with deterministic findings.</p>
        {credUi("gemini", "Gemini")}
        <div className="max-w-sm"><label htmlFor="model" className="eyebrow">Model</label>
          <select id="model" className="input mt-1" value={settings.geminiModel} onChange={(e) => patchSettings({ geminiModel: e.target.value })}>{models.map((m) => <option key={m}>{m}</option>)}</select>
          <p className="mt-1 text-xs text-muted">Changing the model clears nothing: re-run the test to verify access to it.</p></div>
        <details className="rounded-sm border border-hairline p-4"><summary className="cursor-pointer font-medium">How to get a Gemini API key</summary>
          <div className="mt-3"><Steps items={[
            <>Open <Ext href="https://aistudio.google.com/apikey">aistudio.google.com/apikey</Ext>.</>,
            "Sign in with the appropriate Google account.",
            "Create or select an API key.",
            "Paste it above. It is saved encrypted and only your account can use it.",
            "Run the connection test. It checks key validity, access to the selected model, and quota with a tiny generation.",
          ]} /></div></details>
        <button className="btn btn-primary" disabled={!st.gemini.configured || !!busy} onClick={() => test("gemini")}>{busy === "gemini:default" ? "Testing…" : "Test connection"}</button>
        <TestResults results={res.gemini ?? []} busy={busy === "gemini:default"} />
        <LastTests tests={st.gemini.tests} />
      </Step>

      <Step n={5} title="Run a sample audit" state="optional">
        {requiredOk ? (
          <form action="/audit/new" method="get" className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto] sm:items-end">
            <div><label htmlFor="s-url" className="eyebrow">Page URL</label><input id="s-url" name="url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" className="input mt-1" /></div>
            <div><label htmlFor="s-q" className="eyebrow">Query (optional)</label><input id="s-q" name="query" value={query} onChange={(e) => setQuery(e.target.value)} className="input mt-1" /></div>
            <button className="btn btn-primary">Continue</button>
          </form>
        ) : (
          <p className="text-[15px] text-[#333]">Available once the database and TinyFish Search + Fetch have passed their tests. Until then you can <Link href="/demo" className="underline">explore a sample report</Link>.</p>
        )}
      </Step>

      <section className="card p-5 sm:p-6" aria-labelledby="prefs">
        <h2 id="prefs" className="t-display-md">Your defaults &amp; retention</h2>
        <p className="mt-1 text-sm text-muted">Non-secret settings, stored per account.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="dv" className="eyebrow">Default browser verification</label>
            <select id="dv" className="input mt-1" value={settings.defaultVerification} onChange={(e) => patchSettings({ defaultVerification: e.target.value })}><option value="auto">Automatic</option><option value="always">Always</option><option value="off">Off</option></select></div>
          <div><label htmlFor="ret" className="eyebrow">Delete audits older than (days, 0 = keep)</label>
            <input id="ret" type="number" min={0} max={3650} className="input mt-1" defaultValue={settings.retentionDays} onBlur={(e) => patchSettings({ retentionDays: Number(e.target.value) || 0 })} /></div>
          <div><label htmlFor="dl" className="eyebrow">Default country</label><input id="dl" maxLength={2} className="input mt-1" defaultValue={settings.defaultLocation ?? ""} onBlur={(e) => patchSettings({ defaultLocation: e.target.value.toUpperCase() })} placeholder="US" /></div>
          <div><label htmlFor="dg" className="eyebrow">Default language</label><input id="dg" maxLength={3} className="input mt-1" defaultValue={settings.defaultLanguage ?? ""} onBlur={(e) => patchSettings({ defaultLanguage: e.target.value.toLowerCase() })} placeholder="en" /></div>
        </div>
        {msg.settings ? <p role="status" className={cx("mt-3 text-sm", msg.settings.ok ? "text-ok" : "text-crit")}>{msg.settings.text}</p> : null}
      </section>
    </div>
  );
}
