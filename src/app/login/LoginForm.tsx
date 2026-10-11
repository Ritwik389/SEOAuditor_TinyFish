"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cx } from "@/components/ui";

export function LoginForm({ next, initialMode, signupsEnabled }: { next: string; initialMode: "signin" | "signup"; signupsEnabled: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">(signupsEnabled ? initialMode : "signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const r = await fetch(signup ? "/api/auth/signup" : "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
    if (r.ok) {
      // New accounts have no keys yet: send them straight to Setup.
      router.push(signup ? "/setup" : next);
      router.refresh();
      return;
    }
    setErr((await r.json().catch(() => null))?.error?.message ?? "Something went wrong.");
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      {signupsEnabled ? (
        <div role="tablist" aria-label="Account" className="flex rounded-sm bg-hairline p-1">
          {([["signin", "Sign in"], ["signup", "Create account"]] as const).map(([m, label]) => (
            <button key={m} role="tab" type="button" aria-selected={mode === m} onClick={() => { setMode(m); setErr(""); }} className={cx("btn btn-sm flex-1 normal-case tracking-normal", mode === m ? "btn-primary" : "bg-transparent text-ink")}>{label}</button>
          ))}
        </div>
      ) : null}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="eyebrow">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input mt-1" />
        </div>
        <div>
          <label htmlFor="pw" className="eyebrow">Password{signup ? " (10+ characters)" : ""}</label>
          <input id="pw" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 10 : undefined} value={pw} onChange={(e) => setPw(e.target.value)} className="input mt-1" aria-invalid={!!err} aria-describedby={err ? "auth-err" : undefined} />
        </div>
        {err ? <p id="auth-err" role="alert" className="text-sm text-crit">{err}</p> : null}
        <button className="btn btn-primary w-full" disabled={busy || !email || !pw}>{busy ? "Please wait…" : signup ? "Create account" : "Sign in"}</button>
      </form>
    </div>
  );
}
