import { expect, test } from "@playwright/test";
import { MOCK_BASE, alertOf, login, mockReset, mockRequests, mockSet, noHorizontalOverflow, startAudit } from "./helpers";

test.beforeEach(async ({ request }) => mockReset(request));

test("landing page: brand, honest limitation statement, no secrets, direct path into the audit", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Your website has a scent\. Can AI find it\?/);
  await expect(page.getByLabel("Sniffsite home").first()).toBeVisible();
  await expect(page.getByText(/not guaranteed universal AI rankings/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Run an audit/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore sample report" }).first()).toBeVisible();
  const favicon = await page.request.get("/icon.svg");
  expect(favicon.ok()).toBe(true);
});

test("URL safety: private and dangerous targets are rejected before any audit exists", async ({ page }) => {
  await login(page);
  for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "ftp://example.com/x"]) {
    const r = await page.request.post("/api/audits", { data: { url: bad, queries: [] } });
    expect(r.status()).toBe(400);
  }
  await page.goto("/audit/new");
  await page.getByLabel(/Target page URL/).fill("example.com/no-scheme");
  await page.getByRole("button", { name: "Run an audit" }).click();
  await expect(alertOf(page)).toContainText("must start with http");
});

test("live audit: real stage states, evidence-linked findings, partial verification honesty, history, print view", async ({ page, request }) => {
  await mockSet(request, { fetch: { delayMs: 12_000 } }); // long enough to observe the live view even through a cold dev compile
  await login(page);
  await startAudit(page, { query: "product analytics pricing", verification: "off" });

  // Live view driven by persisted state
  await expect(page.getByText(/stages finished/)).toBeVisible();
  await expect(page.getByText(/Fetch in progress/)).toBeVisible();
  // Terminal state re-renders the saved report
  await expect(page.getByRole("heading", { name: "Executive summary" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();

  // Summary facts come from evidence
  await expect(page.getByText("Found at position 2 in checked results")).toBeVisible();
  await expect(page.getByText("user-provided").first()).toBeVisible();
  await expect(page.getByText("Skipped (no objective or turned off)")).toBeVisible();

  // Search section: target highlighted, honest labelling
  const search = page.locator("#search");
  await expect(search.getByText("Your page")).toBeVisible();
  await expect(search.getByText("Match method:")).toBeVisible();

  // Fetch section never invents what Fetch does not return
  const fetchSec = page.locator("#fetch");
  await expect(fetchSec.getByText("Not provided by Fetch")).toBeVisible();
  await expect(fetchSec.getByText(/Not collected \(Fetch returns Markdown/)).toBeVisible();

  // Technical checks: unobserved items are not_checked, never pass
  const tech = page.locator("#technical");
  await expect(tech.getByRole("row", { name: /Broken links/ })).toContainText("Not checked");
  await expect(tech.getByRole("row", { name: /Structured data/ })).toContainText("Not checked");
  await expect(tech.getByRole("row", { name: /robots\.txt/ })).toContainText("Warning"); // GPTBot-specific rule on the mock site
  await expect(tech.getByRole("row", { name: /Sitemap/ })).toContainText("Pass");

  // Semantic findings are labelled AI-interpreted and link to evidence
  const findings = page.locator("#findings");
  const semantic = findings.locator("details", { hasText: "Plans do not say who each tier is for" });
  await semantic.locator("summary").click();
  await expect(semantic.getByText("AI-interpreted")).toBeVisible();
  await expect(semantic.getByText(/Starter costs \$29\/mo and includes 10,000 events/)).toBeVisible(); // verified verbatim excerpt
  const evLink = findings.getByRole("link", { name: "ev_fetch_1" }).first();
  await evLink.click();
  await expect(page.locator("#ev-ev_fetch_1")).toHaveJSProperty("open", true);
  await expect(page.locator("#ev-ev_fetch_1")).toContainText("POST api.fetch.tinyfish.ai");

  // API calls were bounded as promised
  const reqs = await mockRequests(request);
  expect(reqs.filter((r) => r.path.startsWith("/search"))).toHaveLength(1);
  expect(reqs.filter((r) => r.path.startsWith("/fetch"))).toHaveLength(1);
  expect(reqs.filter((r) => r.path.startsWith("/browser"))).toHaveLength(0);

  // History
  await page.goto("/history");
  await expect(page.getByRole("link", { name: /pricing/ }).first()).toBeVisible();
  await page.getByLabel("URL or query").fill("zzz-no-match");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("No audits match these filters")).toBeVisible();
  await page.getByRole("link", { name: "Clear", exact: true }).click();

  // Printable report: all evidence expanded, no external calls needed
  await page.getByRole("link", { name: /pricing/ }).first().click();
  await page.getByRole("link", { name: "Printable report" }).click();
  await expect(page.getByRole("button", { name: /Print/ })).toBeVisible();
  await expect(page.locator("#ev-ev_search_1")).toHaveJSProperty("open", true);
});

test("browser verification runs only when asked and failure degrades to an honest partial report", async ({ page, request }) => {
  await mockSet(request, { browser: { status: 403, body: {} } });
  await login(page);
  await startAudit(page, { query: "product analytics pricing", verification: "always" });
  await expect(page.getByRole("heading", { name: "Executive summary" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Partial report").first()).toBeVisible();
  await expect(page.getByText("Unavailable for this account")).toBeVisible();
  const reqs = await mockRequests(request);
  expect(reqs.filter((r) => r.path.startsWith("/browser") && r.method === "POST")).toHaveLength(1);
});

test("partial audit when Search fails: Fetch evidence and findings survive, error is sanitized", async ({ page, request }) => {
  await mockSet(request, { search: { status: 500 } });
  await login(page);
  await startAudit(page, { query: "product analytics pricing", verification: "off" });
  await expect(page.getByRole("heading", { name: "Executive summary" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Partial report").first()).toBeVisible();
  await expect(page.getByText("Search failed").first()).toBeVisible();
  await expect(page.locator("#fetch")).toContainText("Content extracted".replace("Content extracted", "Requested URL"));
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("test-key");
});

test("cancelling a running audit aborts and marks incomplete stages", async ({ page, request }) => {
  await mockSet(request, { fetch: { delayMs: 20_000 } });
  await login(page);
  await startAudit(page, { query: "product analytics pricing", verification: "off" });
  await expect(page.getByText(/Fetch in progress/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Cancel audit" }).click();
  await expect(page.getByText("Audit cancelled").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
});

test("retry creates a new audit from a failed or partial one", async ({ page, request }) => {
  await mockSet(request, { search: { status: 500 } });
  await login(page);
  await startAudit(page, { query: "product analytics pricing", verification: "off" });
  await expect(page.getByText("Partial report").first()).toBeVisible({ timeout: 45_000 });
  await mockReset(request);
  const first = page.url();
  await page.getByRole("button", { name: /Retry audit/ }).click();
  await expect(page).not.toHaveURL(first);
  await expect(page.getByText("Found at position 2 in checked results")).toBeVisible({ timeout: 45_000 });
});

test("query proposal is labelled as automatically generated and nothing is silently invented", async ({ page }) => {
  await login(page);
  await page.goto("/audit/new");
  await page.getByLabel(/Target page URL/).fill(`${MOCK_BASE}/pricing`);
  await expect(page.getByText(/fetch-only audit/)).toBeVisible();
  await page.getByRole("button", { name: /Propose/ }).click();
  await expect(page.getByText("Automatically generated query.")).toBeVisible();
  await expect(page.getByLabel("Primary search query")).toHaveValue("product analytics pricing");
  await page.getByRole("button", { name: "Run an audit" }).click();
  await expect(page.getByRole("heading", { name: "Executive summary" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("automatically generated").first()).toBeVisible();
});

test("fetch-only audit when no query is given: search is skipped, not faked", async ({ page, request }) => {
  await login(page);
  await startAudit(page, { query: "", verification: "off" });
  await expect(page.getByRole("heading", { name: "Executive summary" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("None: fetch-only audit")).toBeVisible();
  await expect(page.locator("#search")).toContainText("No query, no search");
  expect((await mockRequests(request)).filter((r) => r.path.startsWith("/search"))).toHaveLength(0);
});

test("demo reports are public, clearly labelled, and separate from live audits", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
  const page = await ctx.newPage();
  await page.goto("/demo");
  await expect(page.getByText("Demo · sample data").first()).toBeVisible();
  for (const slug of ["saas-pricing", "ecommerce-product", "b2b-service"]) {
    await page.goto(`/demo/${slug}`);
    await expect(page.getByText("Demonstration data")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Findings and recommendations" })).toBeVisible();
  }
  await page.goto("/demo/ecommerce-product");
  await expect(page.getByText("Not found in checked results").first()).toBeVisible();
  await expect(page.locator("#fetch")).toContainText("Customer reviews (248)");
  await page.goto("/demo/nope");
  await expect(page.getByText(/404|could not be found/i).first()).toBeVisible();
  await ctx.close();
});

test("empty history shows a first-run state", async ({ page }) => {
  await login(page);
  await page.goto("/history?status=failed");
  await expect(page.getByText(/No audits match these filters|No audits yet/)).toBeVisible();
});

test("keyboard: skip link and focus visibility on the audit form", async ({ page }) => {
  await login(page);
  await page.goto("/audit/new");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await noHorizontalOverflow(page);
});

test("no hydration errors on pages that render dates and numbers (regression)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.goto("/setup");
  await page.getByRole("button", { name: "Test Search" }).click();
  await expect(page.getByText(/Search returned/)).toBeVisible();
  await page.reload(); // now "last tested <date>" is server-rendered, the exact case that mismatched before
  await expect(page.getByText(/last tested \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/).first()).toBeVisible();
  await startAudit(page, { query: "product analytics pricing", verification: "off" });
  await expect(page.getByRole("heading", { name: "Executive summary" })).toBeVisible({ timeout: 45_000 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Executive summary" })).toBeVisible();
  await page.goto("/history");
  await expect(page.getByRole("link", { name: /pricing/ }).first()).toBeVisible();
  expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
});
