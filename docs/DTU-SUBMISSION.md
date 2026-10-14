# DTU: SEO Page Auditor — SEOAuditor

Built on [dpp0007/SeoAnalyzer](https://github.com/dpp0007/SeoAnalyzer). The original UI, account isolation, encrypted credentials, persisted stage pipeline and report flow are retained. The application name is SEOAuditor; the old logo, wordmark, decorative ribbon and themed copy have been removed.

## Four meaningful TinyFish endpoints

| Endpoint | Evidence contributed |
| --- | --- |
| `GET https://api.search.tinyfish.ai?query=…` | Live result positions, titles and snippets for up to three target queries. |
| `POST https://api.fetch.tinyfish.ai` | Live extracted page text, metadata and links; requests `ttl: 0`. |
| `POST https://agent.tinyfish.ai/v1/automation/run-async` | Opt-in interaction inspection: opens relevant FAQ disclosures or content tabs and records answers or blockers. |
| `GET https://agent.tinyfish.ai/v1/runs/{id}` | Tracks the actual provider run, retains lifecycle evidence and collects the completed inspection result. |

The existing Browser session creation/termination endpoints remain available. `POST /v1/runs/{id}/cancel` cleans up known Agent runs on audit cancellation or deadline. Agent creation is never automatically retried, so an ambiguous response cannot launch duplicate paid runs.

Contracts: [Agent API](https://docs.tinyfish.ai/agent-api/reference), [structured-output subset](https://docs.tinyfish.ai/key-concepts/structured-output), [Search](https://docs.tinyfish.ai/search-api), [Fetch](https://docs.tinyfish.ai/fetch-api).

## New features

- **Readability × visibility:** a categorical matrix compares observed extraction with discovery across the checked queries. Missing evidence stays unmeasured; it never invents a ranking score or claims causation.
- **Citable answer excerpts:** exact Fetch passages selected for query-term overlap, with source and evidence links. No model-generated answer is presented as page content.
- **Query coverage:** compares meaningful query terms in title, extracted body and target search snippet, including terms lost between surfaces.
- **Interaction gaps:** an Agent-reported quote absent from complete Fetch is a verification lead. It carries medium confidence and requests independent Browser confirmation. Failed or truncated Fetch cannot establish absence.
- **Fix order:** existing page-specific findings become a suggested priority/effort plan with explicit verification steps.
- **Reproducible evidence:** authenticated JSON export includes the original sanitized evidence and derived insights without making new provider requests.

## Demo flow

1. Open `/demo` for the original fictional examples and three additional **dated real-page captures**, collected through TinyFish MCP Search and Fetch on 14 October 2026.
2. Open MDN JavaScript, TinyFish Search docs or Example Domain. Each capture states its date and excerpt limits. It is a replay, not a fresh request.
3. Choose **Audit this page now**, sign in, and configure your own TinyFish key on Setup. Enter a query to exercise Search as well as Fetch.
4. Enable **Agent interaction check** to exercise all four endpoints. Browser verification remains separately selectable. Agent and Browser usage can consume wallet credit.
5. Watch the persisted stages; open the finished report, follow the quote/evidence links and export the JSON.

Live audits accept arbitrary public HTTP(S) page URLs and never use the public capture fixtures. Protected pages report their observed access/extraction failure instead of asserting that all content was read.

## Re-run on several real pages

Set `TINYFISH_API_KEY` in your shell environment (do not commit it), then run:

```bash
npm run demo:live                 # three real pages; fresh Search and Fetch
DEMO_AGENT=1 npm run demo:live    # also Agent creation + Run Status for each page
SMOKE_AGENT=1 npm run smoke:live  # one four-endpoint connection check
```

The multi-page demo stores normalized evidence and deterministic findings under ignored `artifacts/live-audits/<timestamp>/`. The script is separate from the web app's per-account key storage and never runs during tests.

## Validation and deployment

```bash
npm test
npm run typecheck
npm run build
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

HTTP adapter and pipeline tests verify four endpoint requests against local services; browser tests exercise the account/form/report/export flow. Search and Fetch were exercised against real pages through TinyFish MCP. Successful live Agent REST execution requires your own configured key; mocked success does not establish live account entitlement.

The retained app uses Node.js, MongoDB and Playwright/CDP. Deploy it to Vercel or a Node.js host following [DEPLOYMENT.md](DEPLOYMENT.md); it is not converted to a static site.
