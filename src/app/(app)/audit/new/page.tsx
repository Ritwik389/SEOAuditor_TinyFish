import { AppShell } from "@/components/AppShell";
import { getSettings } from "@/lib/config";
import { integrationsStatus } from "@/lib/integrations";
import { requireUser } from "@/lib/security/auth";
import { NewAuditForm } from "./NewAuditForm";
import { demoUser, publicDemoEnabled, publicServiceStatus } from "@/lib/public-demo";

export const metadata = { title: "New audit" };
export const dynamic = "force-dynamic";

export default async function NewAudit({ searchParams }: { searchParams: Promise<{ url?: string; query?: string; retry?: string }> }) {
  const sp = await searchParams;
  if (publicDemoEnabled()) {
    const st = publicServiceStatus();
    return <AppShell user={demoUser} publicDemo>
      <p className="eyebrow">Audit workspace</p>
      <h1 className="t-display-lg mt-2">Run an audit</h1>
      <p className="mt-2 max-w-2xl text-muted">Enter a public page and, ideally, the query it should be found for. No account or API key is needed. Keep this tab open while it runs; reports are saved in this browser.</p>
      <div className="mt-8"><NewAuditForm publicDemo initialUrl={sp.url?.slice(0, 2048) ?? ""} initialQuery={sp.query?.slice(0, 300) ?? ""} ready={st.tinyfish} missing={st.tinyfish ? [] : ["server TinyFish key"]} geminiConfigured={st.gemini} defaults={{ verification: "auto", location: "", language: "" }} /></div>
    </AppShell>;
  }
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]).toString();
  const user = await requireUser(`/audit/new${qs ? `?${qs}` : ""}`);
  const [st, settings] = await Promise.all([integrationsStatus(user.userId), getSettings(user.userId).catch(() => null)]);
  return (
    <AppShell user={user}>
      <p className="eyebrow">Audit workspace</p>
      <h1 className="t-display-lg mt-2">Run an audit</h1>
      <p className="mt-2 max-w-2xl text-muted">Enter a page and, ideally, the query it should be found for. SEOAuditor makes real TinyFish requests and reports only what they return.</p>
      <div className="mt-8">
        <NewAuditForm
          initialUrl={sp.url?.slice(0, 2048) ?? ""}
          initialQuery={sp.query?.slice(0, 300) ?? ""}
          ready={st.readyForLiveAudit}
          missing={[!st.mongodb.configured && "database", !st.tinyfish.configured && "TinyFish"].filter(Boolean) as string[]}
          geminiConfigured={st.gemini.configured}
          defaults={{ verification: settings?.defaultVerification ?? "auto", location: settings?.defaultLocation ?? "", language: settings?.defaultLanguage ?? "" }}
        />
      </div>
    </AppShell>
  );
}
