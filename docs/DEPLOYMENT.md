# Deployment (Vercel-compatible)

Sniffsite needs no separate worker, Redis or Python service. It needs **MongoDB** and a platform that lets a function run long enough for an audit.

## 1. Environment (host settings, not code)

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI`, `MONGODB_DB_NAME` | **yes** | Set by the operator only. Users never enter it |
| `CREDENTIAL_ENCRYPTION_KEY` | **yes** | 32 bytes base64, **only in the environment**. Without it users cannot save their API keys |
| `SESSION_SECRET` | optional | Signs session cookies (defaults to a value derived from `CREDENTIAL_ENCRYPTION_KEY`) |
| `SIGNUPS_ENABLED` | optional | `false` closes registration |
| `GEMINI_MODEL` | optional | default model for accounts that have not chosen one |

There is **no** shared `TINYFISH_API_KEY` / `GEMINI_API_KEY`: each user adds their own on the Setup page, so nobody spends the operator's quota. Never set `SNIFFSITE_STORE`, `SNIFFSITE_ALLOW_PRIVATE_TARGETS`, `TINYFISH_*_URL`, `GEMINI_BASE_URL` or `SNIFFSITE_RATE_LIMIT_MULTIPLIER` in production (they are inert there, but do not rely on that).

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
