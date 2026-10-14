import { ArrowDown, ArrowRight, ArrowUp, Bot, Check, CircleHelp, FileSearch, Quote } from "lucide-react";
import { buildAuditInsights } from "@/lib/analysis/insights";
import type { AgentPayload, AgentRunPayload, EvidenceRecord, FetchPayload, ReportData } from "@/lib/types";
import { ExtLink, cx } from "../ui";

type Insights = ReturnType<typeof buildAuditInsights>;

function EvidenceRefs({ ids }: { ids: string[] }) {
  if (!ids.length) return <span className="text-muted">No supporting evidence collected</span>;
  return <span className="inline-flex flex-wrap gap-2">{ids.map((id) => <a key={id} href={`#ev-${id}`} className="ui-link mono-label underline decoration-[#bbb] underline-offset-2 hover:decoration-ink">{id}</a>)}</span>;
}

function Percent({ value }: { value: number | null }) {
  return value === null ? <span className="text-muted">Not measured</span> : <span className="tabular-nums">{value}%</span>;
}

function ReadabilityMap({ diagnosis }: { diagnosis: Insights["diagnosis"] }) {
  const readable = diagnosis.readability.state === "readable";
  const knownReadability = diagnosis.readability.state !== "unknown";
  const visible = diagnosis.visibility.queriesFound > 0;
  const knownVisibility = diagnosis.visibility.state !== "unknown";
  const canPlot = knownReadability && knownVisibility;
  const cells = [
    { readable: true, visible: false, title: "Readable, missing from search", note: "Review query relevance and discovery signals." },
    { readable: true, visible: true, title: "Readable and discovered", note: "Check whether the extracted page answers the query." },
    { readable: false, visible: false, title: "Extraction and visibility gaps", note: "Resolve access or content gaps, then search again." },
    { readable: false, visible: true, title: "Discovered, extraction limited", note: "Search can show the page while Fetch misses its content." },
  ];
  return (
    <figure className="ui-card card overflow-hidden bg-canvas print-block" aria-labelledby="readability-map-title">
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="readability-map-title" className="text-[17px] font-medium">Readability × search visibility</h3>
          <span className="ui-badge badge">Observed states</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted"><ArrowUp size={15} aria-hidden /> More content available to Fetch</div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline">
          {cells.map((cell) => {
            const selected = canPlot && readable === cell.readable && visible === cell.visible;
            return <div key={cell.title} className={cx("min-h-32 p-3 sm:p-4", selected ? "bg-mint ring-1 ring-inset ring-ink" : "bg-canvas")}>
              {selected ? <span className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium"><Check size={14} aria-hidden /> Observed here</span> : null}
              <p className="text-sm font-medium">{cell.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{cell.note}</p>
            </div>;
          })}
        </div>
        <p className="flex items-center justify-end gap-2 text-sm text-muted">Found in checked queries <ArrowRight size={15} aria-hidden /></p>
        <figcaption className="text-xs leading-relaxed text-muted">
          {canPlot ? "Placement reflects the collected Fetch and Search evidence. Partial extraction sits in the limited row; discovery for some queries sits in the discovered column." : "No placement is shown because an axis has insufficient evidence. Run Search and Fetch to compare them."} These are categories, not a ranking score or proof of causation.
        </figcaption>
      </div>
    </figure>
  );
}

function QueryMatrix({ rows }: { rows: Insights["queryCoverage"] }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="t-display-md">Query coverage across surfaces</h3>
        <p className="mt-1 text-sm text-muted">Percent of meaningful query terms observed in each surface. Lexical overlap does not measure semantic relevance or ranking.</p>
      </div>
      {!rows.length ? <p className="rounded-sm border border-dashed border-hairline p-4 text-sm text-muted">No query was provided. Add a target query to compare what Search communicates with what Fetch can read.</p> : (
        <div className="overflow-x-auto rounded-sm border border-hairline">
          <table className="ui-table w-full border-collapse min-w-[680px]">
            <caption className="sr-only">Query terms observed in extracted title, page body, and target search snippet</caption>
            <thead className="bg-hairline text-muted"><tr><th scope="col" className="th">Query</th><th scope="col" className="th">Title</th><th scope="col" className="th">Fetch body</th><th scope="col" className="th">Search snippet</th><th scope="col" className="th">Visibility gap</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.query}>
              <th scope="row" className="td max-w-56 whitespace-normal align-top font-medium">{row.query}<span className="mt-1 block text-xs font-normal text-muted">{row.resultsChecked === null ? "Search not measured" : row.searchPosition === null ? `Target absent from ${row.resultsChecked} checked results` : `Target at position ${row.searchPosition} of ${row.resultsChecked} checked results`}</span><span className="mt-2 block font-normal"><EvidenceRefs ids={row.evidenceRefs} /></span></th>
              <td className="td align-top"><Percent value={row.titlePercent} /></td>
              <td className="td align-top"><Percent value={row.bodyPercent} /></td>
              <td className="td align-top"><Percent value={row.snippetPercent} /></td>
              <td className="td max-w-72 whitespace-normal align-top">
                {row.bodyPercent === null ? <p className="text-muted">Body coverage could not be measured. See the evidence and limitations.</p> : row.missingBodyTerms.length ? <p>Absent from extracted body: <strong className="font-medium">{row.missingBodyTerms.join(", ")}</strong></p> : <p>All measured query terms occur in the extracted body.</p>}
                {row.snippetPercent !== null && row.missingSnippetTerms.length ? <p className="mt-1 text-muted">Absent from target snippet: {row.missingSnippetTerms.join(", ")}</p> : null}
                {row.limitations.map((note) => <p key={note} className="mt-1 text-xs text-muted">{note}</p>)}
              </td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CitationCards({ readiness }: { readiness: Insights["answerReadiness"] }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h3 className="t-display-md">Citable answer excerpts</h3><span className="ui-badge badge">{readiness.state === "extractable" ? "Excerpts available" : readiness.state === "limited" ? "Limited evidence" : "Unavailable"}</span></div>
      <p className="text-sm text-muted">Exact excerpts from the Fetch evidence show what a retrieval tool could cite. They are candidate source passages, not generated answers or a guarantee of citation.</p>
      {readiness.cards.length ? <div className="grid gap-3 md:grid-cols-2">{readiness.cards.map((card, index) => (
        <figure key={`${card.query}-${index}`} className="ui-card card bg-canvas print-block">
          <div className="space-y-3 p-4">
            <div className="flex items-start gap-2"><Quote size={17} className="mt-0.5 shrink-0" aria-hidden /><p className="text-sm font-medium">{card.query || "Extracted page content"}</p></div>
            <blockquote className="break-words border-l-2 border-hairline pl-3 text-[15px] leading-relaxed">{card.quote}</blockquote>
            <figcaption className="space-y-2 text-xs text-muted">
              <p>{card.matchedTerms.length ? `Matches: ${card.matchedTerms.join(", ")}` : "No query terms matched in this excerpt."}</p>
              <p><EvidenceRefs ids={card.evidenceRefs} /></p>
              <ExtLink href={card.sourceUrl}>Open source page</ExtLink>
            </figcaption>
          </div>
        </figure>
      ))}</div> : <p className="rounded-sm border border-dashed border-hairline p-4 text-sm text-muted">No supported answer excerpt could be selected from the collected Fetch content. Check extraction before rewriting answers.</p>}
      {readiness.notes.map((note) => <p key={note} className="text-xs text-muted">{note}</p>)}
    </div>
  );
}

function FixPlan({ plan }: { plan: Insights["fixPlan"] }) {
  return <div className="space-y-3">
    <div><h3 className="t-display-md">Fix order and verification</h3><p className="mt-1 text-sm text-muted">Priorities come from the report findings. Effort is a suggested planning category; confirm it against your implementation.</p></div>
    {!plan.length ? <p className="rounded-sm border border-dashed border-hairline p-4 text-sm text-muted">No evidenced fix is available. The full findings section explains the checks that ran.</p> : <ol className="space-y-3">{plan.map((fix, i) => <li key={fix.findingId} className="ui-card card bg-canvas print-block">
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><a className="ui-link font-medium underline decoration-[#bbb] underline-offset-2 hover:decoration-ink" href={`#finding-${fix.findingId}`}>{i + 1}. {fix.title}</a><span className="flex flex-wrap gap-1.5"><span className="ui-badge badge">Priority {fix.priority}</span><span className="ui-badge badge">{fix.effort === "small" ? "Small change" : fix.effort === "moderate" ? "Moderate change" : "Investigate first"}</span><span className="ui-badge badge">{fix.impact}</span></span></div>
        <p className="text-sm">{fix.action}</p>
        <p className="text-sm text-muted"><strong className="font-medium text-ink">Verify:</strong> {fix.verification}</p>
        <p className="text-xs"><EvidenceRefs ids={fix.evidenceRefs} /></p>
      </div>
    </li>)}</ol>}
  </div>;
}

const ENDPOINT_PURPOSE: Record<string, string> = {
  search: "Discovers the target page and its snippet for the checked queries.",
  fetch: "Provides the extracted content, metadata and candidate citations.",
  browser: "Compares rendered page content with Fetch extraction.",
};

function EndpointContributions({ evidence }: { evidence: EvidenceRecord[] }) {
  const groups = Object.entries(ENDPOINT_PURPOSE).map(([kind, purpose]) => ({
    kind, purpose, label: kind[0]!.toUpperCase() + kind.slice(1), records: evidence.filter((e) => e.sourceType === kind),
  })).filter((group) => group.records.length).map((group) => ({ ...group, endpoint: group.records[0]!.endpoint }));
  const lifecycle = evidence.filter((e) => e.sourceType === "agent_run");
  const creation = lifecycle.filter((e) => /^POST\s+.*\/automation\/run-async(?:\s|$)/i.test(e.endpoint));
  const status = lifecycle.filter((e) => /^GET\s+.*\/runs\//i.test(e.endpoint));
  const cleanup = lifecycle.filter((e) => /^POST\s+.*\/runs\/.*\/cancel(?:\s|$)/i.test(e.endpoint));
  const observations = evidence.filter((e) => e.sourceType === "agent");
  if (creation.length || observations.length) groups.push({
    kind: "agent", label: "Agent", records: [...creation, ...observations],
    endpoint: creation[0]?.endpoint ?? observations[0]!.endpoint.split(" + ")[0]!,
    purpose: observations.length ? "Checks content behind read-only page interactions and reports blockers."
      : "Creation acknowledgment received; no Agent observations were collected.",
  });
  if (status.length) groups.push({
    kind: "agent_run", label: "Agent run status", records: status, endpoint: status[0]!.endpoint,
    purpose: "Confirms the submitted Agent run's provider lifecycle status.",
  });
  if (cleanup.length) groups.push({
    kind: "agent_cancel", label: "Agent cleanup", records: cleanup, endpoint: cleanup[0]!.endpoint,
    purpose: "Records the provider's response to a best-effort cancellation request.",
  });
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2"><h3 className="t-display-md">TinyFish endpoint contributions</h3><span className="ui-badge badge">{groups.length} endpoint types with evidence</span></div>
    <p className="text-sm text-muted">Each endpoint serves a distinct role. The evidence inspector preserves its sanitized request and observed response. A status record confirms execution; it does not prove page readability.</p>
    {creation.length && !status.length ? <p className="text-sm text-muted">Creation acknowledgment only: no separate run-status evidence was collected.</p> : null}
    {!groups.length ? <p className="text-sm text-muted">No TinyFish evidence was collected.</p> : <div className="overflow-x-auto rounded-sm border border-hairline"><table className="ui-table w-full border-collapse min-w-[540px]">
      <caption className="sr-only">Observed TinyFish endpoint types and their contribution to this audit</caption>
      <thead className="bg-hairline text-muted"><tr><th scope="col" className="th">Endpoint</th><th scope="col" className="th">Contribution</th><th scope="col" className="th">Evidence</th></tr></thead>
      <tbody>{groups.map((group) => <tr key={group.kind}><th scope="row" className="td max-w-64 whitespace-normal align-top font-normal"><span className="block font-medium">{group.label}</span><span className="mono-label mt-1 block break-all text-muted">{group.endpoint}</span></th><td className="td max-w-80 whitespace-normal align-top">{group.purpose}</td><td className="td align-top"><EvidenceRefs ids={group.records.map((e) => e.evidenceId)} /></td></tr>)}</tbody>
    </table></div>}
  </div>;
}

function AgentObservations({ report }: { report: ReportData }) {
  const ev = report.evidence.find((e) => e.sourceType === "agent") as EvidenceRecord<AgentPayload> | undefined;
  const run = [...report.evidence].reverse().find((e) => e.sourceType === "agent_run") as EvidenceRecord<AgentRunPayload> | undefined;
  const payload = ev?.normalizedPayload;
  const fetchRecord = [...report.evidence].reverse().find((e) => e.sourceType === "fetch") as EvidenceRecord<FetchPayload> | undefined;
  const fetched = fetchRecord?.normalizedPayload;
  const canCompareFetch = payload?.fetchComparison !== "unmeasured" && !!fetched && !fetched.error && !fetched.textTruncated && !!fetched.text.trim();
  const state = report.audit.summary?.agent;
  const status = payload ? "Observations collected" : state === "failed" ? "Verification failed" : state === "unavailable" ? "Unavailable" : report.audit.settings.agentVerification ? "No observations collected" : "Not requested";
  return <div className="ui-card card overflow-hidden bg-canvas print-block">
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="t-display-md flex items-center gap-2"><Bot size={20} aria-hidden /> Agent interaction check</h3><span className="ui-badge badge">{status}</span></div>
      <p className="text-sm text-muted">The optional Agent inspects read-only controls such as FAQs and tabs. Its observations help distinguish a Fetch extraction gap from content that only appears after an interaction.</p>
      {run ? <dl className="grid gap-3 rounded-sm border border-hairline bg-hairline p-3 sm:grid-cols-3"><div><dt className="text-xs text-muted">Provider run ID</dt><dd className="mono-label mt-1 break-all">{run.normalizedPayload.runId}</dd></div><div><dt className="text-xs text-muted">Observed provider status</dt><dd className="mt-1 text-sm font-medium">{run.normalizedPayload.status}</dd></div><div><dt className="text-xs text-muted">Run evidence</dt><dd className="mt-1"><EvidenceRefs ids={[run.evidenceId]} /></dd></div>{run.normalizedPayload.error ? <div className="sm:col-span-3"><dt className="text-xs text-muted">Provider error</dt><dd className="mt-1 text-sm">{run.normalizedPayload.error}</dd></div> : null}</dl> : null}
      {payload ? <div className="space-y-4">
        <p className="text-sm"><strong className="font-medium">Objective:</strong> {payload.objective}</p>
        {payload.interactions.length ? <div className="overflow-x-auto"><table className="ui-table w-full border-collapse min-w-[480px]"><caption className="sr-only">Agent's observed interactions</caption><thead><tr><th scope="col" className="th">Control</th><th scope="col" className="th">Action</th><th scope="col" className="th">Observed result</th></tr></thead><tbody>{payload.interactions.map((interaction, i) => <tr key={i}><th scope="row" className="td whitespace-normal font-medium">{interaction.control}</th><td className="td whitespace-normal">{interaction.action}</td><td className="td whitespace-normal">{interaction.result}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted">No interactions were reported.</p>}
        {payload.answers.length ? <details><summary className="min-h-10 cursor-pointer py-2 text-sm font-medium">Agent reported answers ({payload.answers.length})</summary><div className="mt-2 space-y-3">{payload.answers.map((answer, i) => <div key={i} className="rounded-sm border border-hairline p-3"><p className="text-sm font-medium">{answer.question}</p><p className="mt-1 text-sm">{answer.answer}</p>{answer.quote ? <blockquote className="mt-2 border-l-2 border-hairline pl-3 text-xs text-muted">{answer.quote}</blockquote> : null}</div>)}</div></details> : null}
        {!canCompareFetch ? <p className="text-sm text-muted">Fetch comparison was not measured because a complete, successful Fetch extraction was unavailable. Agent answers remain session observations.</p>
          : payload.missingFromFetch.length ? <div><p className="text-sm font-medium">Agent reported content absent from Fetch</p><ul className="mt-1 list-inside list-disc space-y-1 text-sm">{payload.missingFromFetch.map((text, i) => <li key={i}>{text}</li>)}</ul></div>
            : <p className="text-sm text-muted">The Agent reported no additional content absent from Fetch.</p>}
        {payload.blockers.length ? <div><p className="text-sm font-medium">Observed blockers</p><ul className="mt-1 list-inside list-disc space-y-1 text-sm">{payload.blockers.map((text, i) => <li key={i}>{text}</li>)}</ul></div> : null}
        <p className="text-xs text-muted">Agent output is an observation from one session. Its reported content is available for inspection; Fetch citation excerpts above are verified separately. <EvidenceRefs ids={[ev!.evidenceId]} /></p>
      </div> : <p className="rounded-sm border border-dashed border-hairline p-4 text-sm text-muted">{report.audit.settings.agentVerification ? "No usable Agent output was stored. Check the activity log and any run status evidence above." : "Enable Agent interaction check when starting an audit to inspect interactive content. It can consume TinyFish wallet credits."}</p>}
    </div>
  </div>;
}

export function AuditInsights({ report }: { report: ReportData }) {
  const insights = buildAuditInsights(report);
  const { diagnosis } = insights;
  return <div className="space-y-8 text-ink">
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="ui-card card bg-canvas print-block">
        <div className="space-y-4 p-4">
          <FileSearch size={25} aria-hidden />
          <h3 className="t-display-md">{diagnosis.title}</h3>
          <p className="text-[15px] leading-relaxed">{diagnosis.explanation}</p>
          <dl className="grid gap-4 border-y border-hairline py-4 sm:grid-cols-2">
            <div><dt className="text-xs text-muted">Fetch readability</dt><dd className="mt-1 text-[17px] font-medium capitalize">{diagnosis.readability.state}</dd><dd className="mt-1 text-sm text-muted">{diagnosis.readability.wordCount === null ? "No readable content measured" : `${diagnosis.readability.wordCount.toLocaleString("en-US")} extracted words`}</dd></div>
            <div><dt className="text-xs text-muted">Sampled search visibility</dt><dd className="mt-1 text-[17px] font-medium">{diagnosis.visibility.queriesChecked ? `${diagnosis.visibility.queriesFound} / ${diagnosis.visibility.queriesChecked} queries found the page` : "Not measured"}</dd><dd className="mt-1 text-sm text-muted">{diagnosis.visibility.bestPosition === null ? "No matched result position" : `Best observed result position: ${diagnosis.visibility.bestPosition}`}</dd></div>
          </dl>
          <p className="text-xs"><EvidenceRefs ids={[...new Set([...diagnosis.readability.evidenceRefs, ...diagnosis.visibility.evidenceRefs])]} /></p>
          {diagnosis.limitations.map((note) => <p key={note} className="flex items-start gap-2 text-xs text-muted"><CircleHelp size={14} className="mt-0.5 shrink-0" aria-hidden />{note}</p>)}
        </div>
      </div>
      <ReadabilityMap diagnosis={diagnosis} />
    </div>
    <QueryMatrix rows={insights.queryCoverage} />
    <CitationCards readiness={insights.answerReadiness} />
    <FixPlan plan={insights.fixPlan} />
    {insights.botAccess.length ? <div className="space-y-3"><h3 className="t-display-md">Declared AI crawler access</h3><p className="text-sm text-muted">robots.txt directives are publisher preferences. They do not prove how a crawler behaves or whether a page is indexed.</p><ul className="space-y-2">{insights.botAccess.map((bot) => <li key={bot.agent} className="flex flex-wrap items-start justify-between gap-2 border-b border-hairline pb-2 text-sm"><div><span className="font-medium">{bot.agent}</span><span className="ui-badge badge ml-2">{bot.status === "disallowed" ? "Declared disallow" : bot.status === "no_block_observed" ? "No block observed" : "Unknown"}</span><p className="mt-1 text-muted">{bot.note}</p></div><EvidenceRefs ids={bot.evidenceRefs} /></li>)}</ul></div> : null}
    <AgentObservations report={report} />
    <EndpointContributions evidence={report.evidence} />
    <p className="flex items-center gap-2 text-sm text-muted"><ArrowDown size={16} aria-hidden /> Detailed Search, Fetch, findings and source evidence follow.</p>
  </div>;
}
