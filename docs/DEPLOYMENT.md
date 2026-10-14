# Public demo deployment

The deployed SEOAuditor runs with `PUBLIC_DEMO_MODE=true`. It has no sign-in or sign-up flow. Configure `TINYFISH_API_KEY` and `GEMINI_API_KEY` as sensitive, server-only Vercel environment variables and `GEMINI_MODEL=gemini-2.5-flash`. Redeploy after updating variables. No additional API or database is required for this mode.

`POST /api/public-audits` runs the existing audit engine inside one streamed request (`maxDuration=300`). Each request has an isolated temporary workspace. NDJSON snapshots contain real stage states, evidence and findings. A browser-owned stream reader survives client-side navigation and saves the latest 20 reports in localStorage. History, filters, retry, delete, JSON export and print/PDF all work without an account. Keep the tab open while an audit runs; a full reload interrupts that run and presents a retryable report with collected evidence.

Keys never enter the browser, snapshots, report exports or deployment source uploads. Query proposal uses live TinyFish Fetch and Gemini, with an explicitly inferred extracted-title suggestion when Gemini cannot respond. Provider failures preserve evidence and appear in partial reports. The request has a 270-second cleanup deadline; Agent runs also have their own 180-second deadline and cancellation. Public API routes keep the URL/DNS guard, origin checks, body limits and per-instance rate limiting.

Set `PUBLIC_DEMO_MODE=false` to restore private account mode described below. Private accounts and API routes remain protected; public mode does not expose saved account records or allow editing server keys.

Browser tests: `PLAYWRIGHT_CHANNEL=chrome npx playwright test --config=playwright.public.config.ts`.

---

# Deployment (Vercel-compatible)

SEOAuditor needs no separate worker, Redis or Python service. It needs **MongoDB** and a platform that lets a function run long enough for an audit.

## 1. Environment (host settings, not code)

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI`, `MONGODB_DB_NAME` | **yes** | Set by the operator only. Users never enter it |
| `CREDENTIAL_ENCRYPTION_KEY` | **yes** | 32 bytes base64, **only in the environment**. Without it users cannot save their API keys |
| `SESSION_SECRET` | optional | Signs session cookies (defaults to a value derived from `CREDENTIAL_ENCRYPTION_KEY`) |
| `SIGNUPS_ENABLED` | optional | `false` closes registration |
| `GEMINI_MODEL` | optional | default model for accounts that have not chosen one |

In private account mode there is **no** shared `TINYFISH_API_KEY` / `GEMINI_API_KEY`: each user adds their own on the Setup page, so nobody spends the operator's quota. Never set `SNIFFSITE_STORE`, `SNIFFSITE_ALLOW_PRIVATE_TARGETS`, `TINYFISH_*_URL`, `GEMINI_BASE_URL` or `SNIFFSITE_RATE_LIMIT_MULTIPLIER` in production (they are inert there, but do not rely on that).

## 2. Deploy

1. Push the repository and import it in Vercel (framework: Next.js). Build command `npm run build`.
2. Add the environment variables above, redeploy.
3. Open the site, **Create account**, and on **Setup** add your TinyFish key (and optionally Gemini). Run each test.
4. Run a sample audit. Share the URL: anyone can create their own account and bring their own keys.

## 3. Function duration

Audits run inside `after()` on the creating request, with `maxDuration = 300` set on `POST /api/audits`, `/retry` and the query proposal / integration test routes.

* **Vercel Pro/Enterprise**: 300 s is enough for Search ∥ Fetch plus optional Browser verification (session creation alone can take 10–30 s).
* **Hobby**: the platform cap is lower; audits that include Browser verification may be cut off. Progress is persisted after every stage, so an interrupted audit is detected as stale after 6 minutes of silence and shown as failed with **Retry audit**. Prefer `verification: off/auto` on Hobby.
* Self-hosting with `next start` has no such cap.

The opt-in Agent check has a local 180-second deadline and requests a 90-second provider limit. Known active runs are cancelled on interruption; lifecycle evidence is persisted before parsing the result. Search and Fetch findings survive an Agent failure. Prefer Browser and Agent off for deployments with short function limits.

## 4. Data retention

Each user can set *Delete audits older than (days)* on Setup (opportunistic cleanup after each of their audits, 50 per pass; `0` keeps everything). Fetch text stored per audit is capped (`maxEvidenceChars`, default 80,000) and content-hashed.

## 5. Upgrading from the single-admin version

Schema version 2 added `ownerId` to audits and per-user integration/secret/settings documents. Data written by the earlier single-admin build has no owner, so it is invisible to every account (nothing is deleted); drop those collections or re-create the audits. The old single-key unique indexes are dropped automatically on first connection.

## 6. Security checklist

* [ ] HTTPS only (the session cookie is `Secure` in production).
* [ ] Atlas user has least privilege on a single database; Atlas network rules reviewed.
* [ ] `CREDENTIAL_ENCRYPTION_KEY` lives in the host's secret store, not the repo or the database; back it up (a lost key makes saved keys unreadable; users re-enter them).
* [ ] Consider `SIGNUPS_ENABLED=false` once your intended users exist.
* [ ] Rate limits are per instance: add an edge/WAF limit if exposing to the open internet (sign-up and login are the sensitive routes).
