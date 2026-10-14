"use client";

import { BookOpen, History, LogOut, Menu, Plus, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "./brand/Logo";
import { cx } from "./ui";

const LINKS = [
  { href: "/audit/new", label: "New audit", icon: Plus },
  { href: "/history", label: "History", icon: History },
  { href: "/setup", label: "Setup", icon: Settings },
  { href: "/demo", label: "Demo reports", icon: BookOpen },
];

export function AppNav({ email, publicDemo = false }: { email: string; publicDemo?: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  const list = (
    <ul className="flex flex-col gap-1">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = path === href || (href !== "/audit/new" && path.startsWith(href)) || (href === "/audit/new" && path.startsWith("/audit"));
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={cx("flex min-h-11 items-center gap-3 rounded-sm px-3 text-[15px] md:min-h-9", active ? "bg-ink text-white" : "text-ink hover:bg-hairline")}
            >
              <Icon size={16} aria-hidden /> {publicDemo && href === "/setup" ? "Integrations" : label}
            </Link>
          </li>
        );
      })}
      {!publicDemo ? <li>
        <button onClick={logout} className="flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left text-[15px] text-muted hover:bg-hairline md:min-h-9">
          <LogOut size={16} aria-hidden /> Sign out
        </button>
      </li> : null}
    </ul>
  );

  return (
    <>
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-hairline bg-canvas p-4 md:flex">
        <Link href="/" aria-label="SEOAuditor home" className="px-1 pt-1"><Logo size={26} /></Link>
        <nav aria-label="App">{list}</nav>
        <p className="mono-label mt-auto break-all px-1 text-muted">{publicDemo ? "Live demo · no account needed" : email}</p>
      </aside>
      <div className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-hairline bg-canvas px-4 py-2.5 md:hidden">
        <Link href="/" aria-label="SEOAuditor home"><Logo size={24} /></Link>
        <button className="btn btn-outline btn-sm" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(!open)}>
          {open ? <X size={16} aria-hidden /> : <Menu size={16} aria-hidden />}
          <span className="sr-only">{open ? "Close" : "Open"} menu</span>
        </button>
      </div>
      {open ? (
        <nav id="mobile-nav" aria-label="App" className="no-print fixed inset-x-0 top-[57px] z-20 border-b border-hairline bg-canvas p-3 md:hidden">
          {list}
        </nav>
      ) : null}
    </>
  );
}
