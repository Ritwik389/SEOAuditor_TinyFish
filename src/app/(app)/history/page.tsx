import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { AuditStatusBadge, EmptyState, fmtDate } from "@/components/ui";
import { listAudits } from "@/lib/db/repo";
import { StoreNotConfigured } from "@/lib/db/mongo";
import { requireUser } from "@/lib/security/auth";
import type { AuditStatus } from "@/lib/types";

export const metadata = { title: "History" };
export const dynamic = "force-dynamic";

const STATUSES: AuditStatus[] = ["completed", "partial", "failed", "cancelled", "running", "queued", "waiting_config"];

export default async function History({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("/history");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = STATUSES.includes(sp.status as AuditStatus) ? (sp.status as AuditStatus) : undefined;
  const sort = sp.sort === "oldest" ? "oldest" : "newest";
  const from = sp.from && !Number.isNaN(Date.parse(sp.from)) ? new Date(sp.from).toISOString() : undefined;
  const to = sp.to && !Number.isNaN(Date.parse(sp.to)) ? new Date(new Date(sp.to).getTime() + 86_400_000 - 1).toISOString() : undefined;
  const q = sp.q?.slice(0, 200);

  let data;
  try {
    data = await listAudits(user.userId, { q, status, sort, from, to, page, pageSize: 15 });
  } catch (e) {
    if (e instanceof StoreNotConfigured) return <AppShell user={user}><EmptyState title="Database not configured" action={<Link href="/setup" className="btn btn-primary">Open setup</Link>}>Audit history is stored in MongoDB. The administrator must set MONGODB_URI.</EmptyState></AppShell>;
    throw e;
  }
  const filtered = !!(q || status || from || to);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const link = (p: number) => `/history?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <AppShell user={user}>
      <p className="eyebrow">Saved audits</p>
      <h1 className="t-display-lg mt-1">History</h1>

      <form method="get" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]" role="search" aria-label="Filter audits">
        <div><label htmlFor="q" className="eyebrow">URL or query</label><input id="q" name="q" defaultValue={q} className="input mt-1" placeholder="search…" /></div>
        <div><label htmlFor="status" className="eyebrow">Status</label>
          <select id="status" name="status" defaultValue={status ?? ""} className="input mt-1"><option value="">Any</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></div>
        <div><label htmlFor="from" className="eyebrow">From</label><input id="from" name="from" type="date" defaultValue={sp.from} className="input mt-1" /></div>
        <div><label htmlFor="to" className="eyebrow">To</label><input id="to" name="to" type="date" defaultValue={sp.to} className="input mt-1" /></div>
        <div><label htmlFor="sort" className="eyebrow">Sort</label>
          <select id="sort" name="sort" defaultValue={sort} className="input mt-1"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></div>
        <div className="flex items-end gap-2"><button className="btn btn-primary">Apply</button>{filtered ? <Link href="/history" className="btn btn-outline">Clear</Link> : null}</div>
      </form>

      <div className="mt-6">
        {data.items.length === 0 ? (
          filtered ? (
            <EmptyState title="No audits match these filters" action={<Link href="/history" className="btn btn-outline">Clear filters</Link>}>Try a different URL, query or date range.</EmptyState>
          ) : (
            <EmptyState title="No audits yet" action={<><Link href="/audit/new" className="btn btn-primary">Run your first audit</Link><Link href="/demo" className="btn btn-outline">Explore sample report</Link></>}>Saved audits appear here with their evidence, so you can reopen, print or re-run them.</EmptyState>
          )
        ) : (
          <ul className="card divide-y divide-hairline">
            {data.items.map((a) => (
              <li key={a.auditId}>
                <Link href={`/audit/${a.auditId}`} className="flex flex-col gap-2 p-4 hover:bg-[#fafafa] sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.label || a.targetUrl}</span>
                    <span className="block truncate text-sm text-muted">{a.label ? `${a.targetUrl} · ` : ""}{a.queries[0] ? `“${a.queries[0].text}”${a.queries.length > 1 ? ` +${a.queries.length - 1}` : ""}` : "fetch-only"}</span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-3 text-sm text-muted">
                    {a.summary ? <span>{a.summary.findingsCount} finding{a.summary.findingsCount === 1 ? "" : "s"}</span> : null}
                    <span>{fmtDate(a.createdAt)}</span>
                    <AuditStatusBadge s={a.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pages > 1 ? (
        <nav aria-label="Pagination" className="mt-6 flex items-center justify-between">
          {page > 1 ? <Link href={link(page - 1)} className="btn btn-outline btn-sm">← Newer</Link> : <span />}
          <span className="mono-label text-muted">Page {page} of {pages} · {data.total} audits</span>
          {page < pages ? <Link href={link(page + 1)} className="btn btn-outline btn-sm">Older →</Link> : <span />}
        </nav>
      ) : null}
    </AppShell>
  );
}
