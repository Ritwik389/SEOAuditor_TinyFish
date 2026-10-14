# SEOAuditor

An evidence-based SEO and AI search visibility auditor built for the TinyFish × DTU workshop challenge, extending [SeoAnalyzer](https://github.com/dpp0007/SeoAnalyzer).

[Open the live demo](https://seo-auditor-five-woad.vercel.app/) — no sign-in or personal API keys needed.

## What it does

Enter any public HTTP(S) URL and optionally up to three target search queries. SEOAuditor compares search discovery, extracted page content, rendered content and answers behind interactive controls, then reports specific fixes supported by evidence.

- Live TinyFish Search and Fetch, with optional Browser verification.
- Optional Agent interaction check with separately tracked run status: four TinyFish endpoints contribute to a deep audit (Search, Fetch, Agent creation, Run Status), plus Browser session creation/cleanup.
- Measured extraction/discovery matrix, query-term coverage, verbatim quote cards and prioritized fix plans.
- Robots.txt and sitemap checks with SSRF protection.
- Gemini analysis with validated evidence references and quoted excerpts; deterministic findings survive provider failures.
- Real progress, cancellation, partial reports and retries.
- Browser-local history and filters; JSON evidence export and printable PDF reports.
- Dated live captures of MDN JavaScript documentation, TinyFish Search documentation and Example Domain, alongside clearly labelled fictional samples.

Search results are sampled TinyFish evidence, not guaranteed Google rankings. Truncated or failed extraction is labelled and never treated as proof that content is absent.

## Run locally

Requires Node 20.19 or newer.

```sh
npm ci
cp .env.example .env
npm run dev
```

For the no-account demo, set `PUBLIC_DEMO_MODE=true`, `TINYFISH_API_KEY` and optionally `GEMINI_API_KEY` in `.env`. This deployment uses the tested `GEMINI_MODEL=gemini-2.5-flash`. Keys stay server-side. No database is required in public mode.

Reports are saved in the browser (latest 20). Keep the tab open while a run streams. Export JSON or print to PDF to keep a copy; clearing browser data removes local history.

Set `PUBLIC_DEMO_MODE=false` for the original private account mode, which requires MongoDB and session/encryption secrets and stores each account's own keys. [Deployment instructions](docs/DEPLOYMENT.md) describe both modes.

## Verify

```sh
npm run typecheck
npm test
npm run build
PLAYWRIGHT_CHANNEL=chrome npx playwright test --config=playwright.public.config.ts
```

Private-account regression tests use `playwright.config.ts`. Live developer checks: `npm run smoke:live` and `npm run demo:live`; `DEMO_AGENT=1` includes the optional paid Agent verification.

[Submission notes](docs/DTU-SUBMISSION.md) · [LinkedIn and X drafts](docs/LAUNCH-POSTS.md)
