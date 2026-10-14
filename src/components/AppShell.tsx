import Link from "next/link";
import { integrationsStatus } from "@/lib/integrations";
import type { PageUser } from "@/lib/security/auth";
import { AppNav } from "./AppNav";
import { Banner } from "./ui";

/** Authenticated page chrome. Each page calls requireUser() before rendering this. */
export async function AppShell({ user, children, wide = false, banner = true, publicDemo = false }: { user: PageUser; children: React.ReactNode; wide?: boolean; banner?: boolean; publicDemo?: boolean }) {
  const st = banner && !publicDemo ? await integrationsStatus(user.userId) : null;
  const missing: string[] = [];
  if (st) {
    if (!st.mongodb.configured) missing.push("the database (MONGODB_URI, set by the administrator)");
    if (!st.tinyfish.configured) missing.push("your TinyFish API key");
  }
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AppNav email={user.email} publicDemo={publicDemo} />
      <main id="main" className={`min-w-0 flex-1 px-4 py-6 sm:px-8 md:py-10 ${wide ? "" : "mx-auto max-w-[1100px]"}`}>
        {st?.storage.mode === "memory" ? (
          <div className="mb-6">
            <Banner tone="warn" title="Test store active: nothing is saved durably">
              This server runs with the in-memory test store (development only). Audits disappear on restart.
            </Banner>
          </div>
        ) : null}
        {missing.length ? (
          <div className="mb-6">
            <Banner tone="warn" title="Live audits are unavailable until setup is complete" action={<Link href="/setup" className="btn btn-primary btn-sm">Open setup</Link>}>
              Missing: {missing.join(" and ")}. Add your keys on the Setup page. You can still <Link href="/demo" className="underline">explore sample reports</Link>.
            </Banner>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
