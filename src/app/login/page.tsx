import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { Banner } from "@/components/ui";
import { authReady, currentUser } from "@/lib/security/auth";
import { LoginForm } from "./LoginForm";
import { publicDemoEnabled } from "@/lib/public-demo";

export const metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; mode?: string }> }) {
  const { next, mode } = await searchParams;
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/audit/new";
  if (publicDemoEnabled()) redirect(dest.startsWith("/login") ? "/audit/new" : dest);
  const ready = authReady();
  if (ready.ok && (await currentUser())) redirect(dest);
  return (
    <main id="main" className="mx-auto grid min-h-screen max-w-md content-center gap-6 px-4 py-12">
      <Link href="/" aria-label="SEOAuditor home"><Logo size={32} /></Link>
      <div>
        <h1 className="t-display-lg">Sign in to SEOAuditor</h1>
        <p className="mt-2 text-muted">Each account has its own audits and its own TinyFish and Gemini API keys, which you add after signing in. Demo reports stay public.</p>
      </div>
      {!ready.ok ? (
        <Banner tone="error" title="Accounts are not available yet">{ready.reason} This is a server setting; nothing you enter here can fix it.</Banner>
      ) : (
        <LoginForm next={dest} initialMode={mode === "signup" ? "signup" : "signin"} signupsEnabled={process.env.SIGNUPS_ENABLED !== "false"} />
      )}
      <Link href="/demo" className="text-sm underline">Explore sample reports without an account</Link>
    </main>
  );
}
