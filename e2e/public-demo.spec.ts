import { expect, test } from "@playwright/test";

test("anonymous live audit, four endpoints, saved history, reload, export and print", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/sign in|sign up/i)).toHaveCount(0);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/audit\/new$/);
  await page.getByLabel("Target page URL").fill("http://127.0.0.1:4030/pricing");
  await page.getByLabel("Primary search query").fill("product analytics pricing");
  await page.getByRole("radio", { name: "Off Search and Fetch only." }).check();
  await page.getByLabel("Inspect interactive content").check();
  await page.getByRole("button", { name: "Run an audit", exact: true }).click();
  await expect(page).toHaveURL(/\/audit\/[a-f0-9]{16}$/);
  await expect(page.getByRole("button", { name: "Export evidence" })).toBeVisible();
  const auditUrl = page.url();
  await page.reload();
  await expect(page.getByRole("button", { name: "Export evidence" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export evidence" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^seo-auditor-.+\.json$/);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const report = JSON.parse(Buffer.concat(chunks).toString());
  expect(report.audit.summary.apiCalls).toMatchObject({ search: 1, fetch: 1, agent: 1 });
  expect(report.evidence.map((e: { endpoint: string }) => e.endpoint)).toEqual(expect.arrayContaining([
    "GET api.search.tinyfish.ai", "POST api.fetch.tinyfish.ai", "POST agent.tinyfish.ai/v1/automation/run-async", "GET agent.tinyfish.ai/v1/runs/{id}",
  ]));
  expect(JSON.stringify(report)).not.toContain("test-key");
  await page.getByRole("link", { name: "Printable report" }).click();
  await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeVisible();
  await page.goto("/history");
  await expect(page.getByRole("link", { name: /pricing.*findings/ })).toBeVisible();
  await page.goto(auditUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByRole("heading", { name: "No audits yet" })).toBeVisible();
});

test("query proposal, cancellation, retry and mobile navigation need no account", async ({ page, request }) => {
  await request.post("http://127.0.0.1:4031/__reset");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/audit/new");
  await page.getByLabel("Target page URL").fill("http://127.0.0.1:4030/pricing");
  await page.getByRole("button", { name: "Propose", exact: true }).click();
  await expect(page.getByLabel("Primary search query")).not.toHaveValue("");
  await page.getByRole("radio", { name: "Off Search and Fetch only." }).check();
  await request.post("http://127.0.0.1:4031/__set", { data: { fetch: { delayMs: 3000 } } });
  await page.getByRole("button", { name: "Run an audit", exact: true }).click();
  await page.getByRole("button", { name: "Cancel audit" }).click();
  await expect(page.getByRole("button", { name: "Retry audit" })).toBeVisible();
  const old = page.url();
  await request.post("http://127.0.0.1:4031/__reset");
  await page.getByRole("button", { name: "Retry audit" }).click();
  await expect(page).not.toHaveURL(old);
  await expect(page.getByRole("button", { name: "Export evidence" })).toBeVisible();
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await page.getByRole("link", { name: "Integrations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Integrations", exact: true })).toBeVisible();
  await expect(page.getByText("Server key configured")).toHaveCount(2);
});
