"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const STEPS = [
  { href: "/setup", label: "Connect keys" },
  { href: "/audit/new", label: "Run audit" },
  { href: "/history", label: "Read report" },
];

/** Where you are in Connect → Audit → Report. Hidden on pages outside the flow (e.g. demo). */
export function Journey() {
  const path = usePathname();
  const cur = path.startsWith("/setup") ? 0 : path === "/audit/new" ? 1 : path.startsWith("/audit") || path.startsWith("/history") ? 2 : -1;
  if (cur < 0) return null;
  return (
    <ol aria-label="Progress" className="no-print mb-8 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs uppercase tracking-wider">
      {STEPS.map((s, i) => (
        <li key={s.href} className="flex items-center gap-2">
          <Link href={s.href} aria-current={i === cur ? "step" : undefined} className={cx("flex items-center gap-2", i === cur ? "text-ink" : "text-muted hover:text-ink")}>
            <span className={cx("grid h-5 w-5 place-items-center rounded-full border text-[10px]", i === cur ? "border-ink bg-ink text-white" : i < cur ? "border-ink text-ink" : "border-hairline")}>{i < cur ? "✓" : i + 1}</span>
            {s.label}
          </Link>
          {i < STEPS.length - 1 ? <span aria-hidden className="h-px w-6 bg-hairline sm:w-10" /> : null}
        </li>
      ))}
    </ol>
  );
}
