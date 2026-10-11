import { AppShell } from "@/components/AppShell";
import { GEMINI_MODELS, getSettings } from "@/lib/config";
import { integrationsStatus } from "@/lib/integrations";
import { requireUser } from "@/lib/security/auth";
import { SetupWizard } from "./SetupWizard";

export const metadata = { title: "Setup & integrations" };
export const dynamic = "force-dynamic";

export default async function Setup() {
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
