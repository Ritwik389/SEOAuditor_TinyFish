# TraceSEO

**Your website has a scent. Can AI find it?**

TraceSEO is an evidence-first AI search visibility auditor built for the **TinyFish × AIMS-DTU** workshop. For a page and (ideally) the query it should be found for, it:

1. **Searches** with TinyFish Search: does the page appear for the query, where, with what title and snippet?
2. **Fetches** with TinyFish Fetch: what can an AI-oriented retrieval pipeline actually extract (text, headings, metadata, links)?
3. **Verifies** with TinyFish Browser, only when there is a concrete question (empty/blocked/thin Fetch, or you turn it on).
4. **Diagnoses** with deterministic checks plus a Gemini reading of the *collected evidence*, producing prioritized findings that each link to the evidence behind them.

Results describe **sampled retrieval evidence** (one search, one fetch, one moment in time). They are not guaranteed Google rankings or statements about every crawler.

---

## Quick start

```bash
npm install
cp .env.example .env.local       # then fill in the values (see below)
npm run dev                      # http://localhost:3000

```

Set `MONGODB_URI` and `CREDENTIAL_ENCRYPTION_KEY` in `.env.local` (see below), open the site, **create an account**, and add your own TinyFish (and optionally Gemini) key on **Setup**.

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js development / production build / production server |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Unit + integration tests (vitest). Mocked HTTP only, **no paid API calls** |
| `npm run test:e2e` | End-to-end tests (Playwright + installed Microsoft Edge) against real Next servers with **mock** TinyFish/Gemini |
| `npm run smoke:live` | **Optional.** Real requests to TinyFish (and Gemini if configured). Needs your keys. `SMOKE_BROWSER=1` also opens one billable Browser session |
| `npm run mock` | Local mock TinyFish/Gemini/target site on `127.0.0.1:4010` for UI work |

`design.md` is the design source of truth (tokens, type, components). One deliberate deviation is documented in `src/app/globals.css`: its body grey (#999) fails WCAG AA, so readable secondary text uses #595959.

---

## Accounts and who owns what

**Multi-user.** Anyone can create an account (email + password, hashed with scrypt). Each account has its **own audits, settings and API keys**, and sees nothing of anyone else's: every read and write is scoped by owner, other users get "not found", and keys are encrypted under a per-user binding. There is **no shared TinyFish or Gemini key**: each user pays their own provider usage. Set `SIGNUPS_ENABLED=false` to close registration.

**The database is the operator's concern.** `MONGODB_URI` is set in the server environment only; it is never requested on the website, so no database credential passes through a browser. The Setup page shows its status and runs a read/write verification.

---

## Credentials: how to get each one

Users add their keys on the **Setup** page after signing in (these steps are also shown there). Keys are saved encrypted and used only for that user's audits.

### MongoDB Atlas (operator, required)

1. Go to [https://www.mongodb.com/atlas](https://www.mongodb.com/atlas), create a project and a database deployment (free tier is fine).
2. Create a database user with read/write on one database.
3. Network Access: for Vercel allow `0.0.0.0/0` (dynamic IPs) and rely on a strong password; for a fixed server allow only its IP.
4. Connect → Drivers → copy the `mongodb+srv://…` string.
5. Set `MONGODB_URI` (and optionally `MONGODB_DB_NAME`, default `traceseo`) in the host environment, redeploy.
6. Setup → **Test connection** (writes, reads back and deletes a probe document).

Indexes and a schema-version marker are created automatically on first connection (`src/lib/db/mongo.ts`).

### TinyFish (each user; required for live audits)

1. Docs: [https://docs.tinyfish.ai/](https://docs.tinyfish.ai/). Keys: [https://agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys) → *Create API Key* (shown once).
2. Paste it on Setup → **Save securely**.
3. Setup tests **Search, Fetch and Browser separately**, each with a real request. A key that authenticates is not treated as proof that all three work.
4. Per the docs, Search and Fetch are free within a daily allowance; Browser sessions are billed from the user's wallet. Some operations can need an account entitlement; if a test says "not enabled", that is an account matter.

Verified contracts (from the official docs and OpenAPI documents): auth header `X-API-Key`;
Search `GET https://api.search.tinyfish.ai?query=…&location=…&language=…`; Fetch `POST https://api.fetch.tinyfish.ai` (`urls`, `format`, `links`, `page_metadata`, `ttl`); Browser `POST https://api.browser.tinyfish.ai` → `{session_id, cdp_url, base_url}`, driven over CDP, ended with `DELETE …/{session_id}`.

### Gemini (each user; optional)

1. [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey) → sign in → create/select a key.
2. Paste it on Setup and choose the model.
3. **Test connection** checks key validity, model access and quota with a tiny generation.

Without Gemini, audits still run with deterministic findings; only interpretation, entity extraction and query proposals are unavailable.

### How saved keys are protected

Encrypted with **AES-256-GCM** using `CREDENTIAL_ENCRYPTION_KEY` (32 random bytes, base64, **kept in the environment, not the database**), with the user id and provider bound in as authenticated data, so one user's ciphertext cannot be decrypted as another's. Never returned to the browser (status shows only the last 4 characters), never logged. If the key or database is missing, saving is refused with an explanation: nothing is ever implied to be saved when it was not.

Generate an encryption key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

---

## Environment variables

See `.env.example` (placeholders only). Summary: `MONGODB_URI`, `MONGODB_DB_NAME`, `CREDENTIAL_ENCRYPTION_KEY` (required), `SESSION_SECRET`, `SIGNUPS_ENABLED`, `GEMINI_MODEL`, `APP_URL` (optional). TinyFish/Gemini keys are **not** environment variables. Test-only switches (`TRACESEO_STORE=memory`, `TRACESEO_ALLOW_PRIVATE_TARGETS`, `TINYFISH_*_URL`, `GEMINI_BASE_URL`, `TRACESEO_RATE_LIMIT_MULTIPLIER`) are ignored or inert when `NODE_ENV=production`.

---

## Architecture

```
Browser ──HTTPS──▶ Next.js (App Router)
                    ├─ app/            pages (landing, setup, audit, history, demo, report)
                    ├─ app/api/        typed route handlers (Zod, session auth, CSRF origin check, rate limit, size limit)
                    └─ lib/
                       ├─ audit/orchestrator.ts   stage state machine; Search ∥ Fetch; persists after every stage
                       ├─ tinyfish/               client (retries, timeouts), search, fetch, browser (CDP), tests
                       ├─ gemini/provider.ts      AnalysisProvider abstraction + Gemini implementation
                       ├─ analysis/               Layer 1 deterministic (extract, compare, robots, seo, findings)
                       │                          Layer 2 semantic (Zod-validated, excerpt-verified)
                       ├─ security/               SSRF guard, redaction, AES-GCM, accounts and sessions
                       ├─ db/                     Mongo (cached client), repo, in-memory emulator (dev/test only)
                       └─ demo/                   3 fictional demo reports built by the SAME analysis code

```

**Execution model (Vercel-compatible, no worker).** `POST /api/audits` validates and persists a queued audit, then runs the pipeline inside `after()` on that invocation (`maxDuration = 300`). The orchestrator claims the audit atomically (`queued → running`), persists stages/log/evidence after every step, and the UI **polls persisted state** (`GET /api/audits/:id/events`). Nothing relies on process memory: a second instance reads the same truth, and an audit whose function died is detected as stale and shown as failed with a Retry button. Cancellation sets a persisted flag; the running invocation notices within ~1.5 s, aborts in-flight requests (including ending the Browser session) and marks incomplete stages.

**Evidence → findings.** Every Search, Fetch, Browser, robots.txt and sitemap result is stored as an `auditEvidence` record (normalized, sanitized, content-hashed, with limitations). Findings and checks reference evidence IDs; the report links each reference to the inspector.

**Data model.** `users`, `audits` (owner-scoped; stages and log embedded so one read serves live polling), `auditEvidence`, `auditFindings`, `integrationMetadata` (per user, safe test results only), `integrationSecrets` (per user, encrypted), `settings` (per user), `meta` (schema version). Embedding stages in `audits` deviates from the suggested separate `auditStages` collection by design.

### Routes

| Method & path | Purpose |
| --- | --- |
| `POST/GET /api/audits` | create (validated, SSRF-checked) / paginated history with search, status, date, sort |
| `GET/DELETE /api/audits/:id` | detail / delete (active audits must be cancelled first) |
| `GET /api/audits/:id/events` | live job state from persisted data |
| `POST /api/audits/:id/cancel` · `/retry` | cancel · new audit with the same inputs |
| `GET /api/audits/:id/report` | report data (audit + evidence + findings) |
| `POST /api/query-proposal` | proposes (never silently applies) a query |
| `GET /api/integrations/status` | safe status (booleans, sources, last-4, test results) |
| `POST /api/integrations/configure` | save/remove an encrypted key |
| `POST /api/integrations/:provider/test` | real-request tests (`mongodb`, `tinyfish` + `operations`, `gemini`) |
| `GET/PATCH /api/settings` | non-secret settings (strict schema) |
| `POST /api/auth/signup` · `/login` · `/logout` | accounts and sessions |

---

## Demo mode vs live mode

* **Demo** (`/demo`, public): three fictional pages (SaaS pricing, e-commerce product, B2B service). They run through the *same analysis engine* from canned inputs, and are labelled “Demo · sample data” everywhere. They are never produced by live calls and never mixed into live data.
* **Live** (signed-in user with their own verified TinyFish key; needs the operator database): every audit makes real requests and stores what came back.

If credentials are missing you are offered **Configure integrations** and **Explore sample report**.

---

## Testing

```bash
npm test              # 136 unit/integration tests; 1 more runs only with MONGODB_URI_TEST (real database)
npm run test:e2e      # Playwright: needs Microsoft Edge installed (uses channel "msedge")

```

Covered: URL normalization/validation/matching, SSRF (IPv4/IPv6 ranges, DNS, redirect handling), redaction, encryption, session tokens, rate limiting, adapters against mock HTTP (headers, params, normalization, retries, no-retry on auth/credits, abort), Gemini provider and test, Zod validation of model output (drop unsupported findings, discard non-verbatim excerpts, prompt-injection wrapping), deterministic checks and findings, prioritization, status transitions, orchestrator (partial failures, browser unavailable, semantic failure, idempotent claim, cancellation, stale audits), memory-store/Mongo parity. E2E: login/auth, CSRF, first-run setup, missing credentials, live audit, partial audit, cancel, retry, query proposal, demo, history/empty states, print view, mobile overflow, skip link.

Real-database test: `MONGODB_URI_TEST=mongodb+srv://… npx vitest run tests/mongo.integration.test.ts` (throwaway database, dropped afterwards).

---

## Deployment

See [docs/DEPLOYMENT.md](https://www.google.com/search?q=docs/DEPLOYMENT.md).

## Security

* **SSRF**: scheme allow-list (http/https), no URL credentials, restricted ports, local/internal hostnames blocked, every resolved DNS address must be public, and the *connection itself* uses a validating `lookup` (defeats DNS rebinding). Redirects are followed manually and revalidated per hop (robots.txt/sitemap fetches). The Browser and Fetch run on TinyFish infrastructure but targets are validated first.
* **Secrets**: never in client code, URLs, logs (redaction filter), `NEXT_PUBLIC_*`, or API responses. Encrypted at rest with a key outside the database. MongoDB URI is env-only.
* **Access**: accounts with scrypt-hashed passwords, HMAC-signed `HttpOnly; SameSite=Strict; Secure` session cookie, generic sign-in errors (no account enumeration), Origin check on every write, per-IP rate limits (process-local; see limitations), 32 KB body cap, Zod validation on every body.
* **Tenant isolation**: every audit/evidence/finding/settings/secret query is scoped by owner at the repository layer (internal callers must pass `null` explicitly), and foreign resources return 404, not 403.
* **Untrusted content**: page text, metadata and snippets are treated as data. Fetched content is rendered as inert text (never HTML); only `http(s)` links become anchors, with `rel="noopener noreferrer nofollow"`. The model receives evidence wrapped in tagged data blocks with closing tags neutralized, has no tools or URL access, must cite real evidence IDs, and any quote not verbatim in the cited evidence is discarded.
* **Not claimed**: TraceSEO makes no assertions about Google rankings, indexing status, AI training or crawler compliance beyond the observed directives.

## Known limitations

* Live TinyFish success is verified only against local mocks plus real-endpoint auth rejection (a key was not available): run `npm run smoke:live` with your key to verify Search/Fetch; Browser CDP driving (`playwright-core` `connectOverCDP`) is implemented per the docs but has not been exercised against a live session.
* **PDF**: use *Print / Save as PDF* from the printable report (print stylesheet). No server-side PDF generator.
* **Rate limiting** is per server process; on serverless each warm instance counts separately.
* Broken-link testing, sitemap-index traversal and audit-to-audit comparison are not implemented. Structured data is only evaluated when Browser verification ran.
* Fetch does not return HTTP status, headers or raw HTML; TraceSEO shows “Not provided by Fetch” rather than inferring.
* Gemini model IDs follow the current Google docs at build time; adjust `GEMINI_MODELS` in `src/lib/config.ts` if they change.
* Accounts are email + password only: no email verification, password reset or MFA yet. Do not rely on this for high-assurance use without adding them.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| “Accounts are not available yet” | `MONGODB_URI` or `CREDENTIAL_ENCRYPTION_KEY`/`SESSION_SECRET` missing on the server |
| Cannot save keys | the operator has not set `CREDENTIAL_ENCRYPTION_KEY` (or has no database) |
| Setup says MongoDB “not set” | `MONGODB_URI` missing in the *server* environment; redeploy after setting |
| Mongo test fails at connect | Atlas Network Access does not allow the host; wrong user/password |
| Mongo test fails at write | database user has read-only role |
| TinyFish `INVALID_API_KEY` | revoked or mistyped key (keys are shown once at creation): replace it on Setup |
| TinyFish `FREE_ALLOWANCE_EXHAUSTED` / `INSUFFICIENT_CREDITS` | daily free allowance used (resets 00:00 UTC) and no wallet credit |
| Browser “not enabled” | account entitlement/credits; audits still complete without verification |
| Audit shows “interrupted” | the function hit its time limit or restarted; press *Retry audit* |
| Rate limited | wait the number of seconds shown; limits are per IP |
