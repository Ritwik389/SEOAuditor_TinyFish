import { AppShell } from "@/components/AppShell";
import { GEMINI_MODELS, getSettings } from "@/lib/config";
import { integrationsStatus } from "@/lib/integrations";
import { requireUser } from "@/lib/security/auth";
import { SetupWizard } from "./SetupWizard";
import { demoUser, publicDemoEnabled, publicServiceStatus } from "@/lib/public-demo";
import Link from "next/link";

export const metadata = { title: "Setup & integrations" };
export const dynamic = "force-dynamic";

export default async function Setup() {
  if (publicDemoEnabled()) {
    const st = publicServiceStatus();
    return <AppShell user={demoUser} publicDemo banner={false}>
      <p className="eyebrow">Live demo</p><h1 className="t-display-lg mt-1">Integrations</h1>
      <p className="mt-2 text-muted">API keys are configured on the server. You can run audits without an account or your own keys. Provider availability is recorded in each audit.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">{[
        ["TinyFish", st.tinyfish, "Search and Fetch compare discovery with extracted content. Optional Browser and Agent checks inspect rendered and interactive content."],
        ["Gemini", st.gemini, "Adds evidence-based analysis and query suggestions. Deterministic findings remain available if the model cannot respond."],
      ].map(([name, configured, detail]) => <section key={String(name)} className="ui-card card p-5"><h2 className="t-display-sm">{name}</h2><p className="ui-badge badge mt-3">{configured ? "Server key configured" : "Server key missing"}</p><p className="mt-3 text-sm text-muted">{detail}</p></section>)}</div>
      <section className="ui-card card mt-6 p-5"><h2 className="t-display-sm">Report storage</h2><p className="mt-2 text-sm text-muted">Your latest 20 reports are kept in this browser. Export evidence as JSON or print a report as PDF to keep a copy. Clearing browser data removes local history.</p></section>
      <Link href="/audit/new" className="ui-btn btn btn-primary mt-6">Run an audit</Link>
    </AppShell>;
  }
  const user = await requireUser("/setup");
  const [status, settings] = await Promise.all([integrationsStatus(user.userId), getSettings(user.userId).catch(() => null)]);
  return (
    <AppShell user={user} banner={false} wide>
      <div className="mx-auto max-w-[900px]">
        <p className="eyebrow">First run</p>
        <h1 className="t-display-lg mt-1">Setup &amp; integrations</h1>
        <p className="mt-2 max-w-2xl text-muted">Add your own TinyFish and Gemini API keys. They are encrypted and used only for your audits. Nothing is reported as working until a real request has succeeded.</p>
        <div className="mt-8">
          <SetupWizard initial={status} models={[...GEMINI_MODELS]} initialSettings={settings ?? { geminiModel: "gemini-3.8-flash", defaultVerification: "auto", retentionDays: 0, maxEvidenceChars: 80000 }} />
        </div>
      </div>
    </AppShell>
  );
}
