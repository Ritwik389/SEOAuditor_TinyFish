import { expect, test } from "@playwright/test";
import { mockReset, mockRequests, signUpUi, uniqueEmail } from "./helpers";

test.beforeEach(async ({ request }) => mockReset(request));

test("a brand-new user adds their OWN keys in the frontend; nothing is claimed working until a real request passes", async ({ page, request }) => {
  await signUpUi(page, uniqueEmail("onboard"));

  // No shared server key exists, so a fresh account cannot run live audits yet.
  await expect(page.getByText("Setup is not complete")).toBeVisible();
  await page.goto("/audit/new");
  await expect(page.getByText("Live audits are unavailable until setup is complete")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run an audit" })).toBeDisabled();
  expect((await page.request.post("/api/audits", { data: { url: "https://example.com", queries: [] } })).status()).toBe(409);
  await page.goto("/setup");
  await expect(page.getByRole("button", { name: "Test Search" })).toBeDisabled();

  // Database step is only tested, never entered.
  await page.getByRole("button", { name: "Test connection" }).first().click();
  await expect(page.getByText(/write, read and delete verified|In-memory TEST store/)).toBeVisible();
  await expect(page.getByText(/connection string|MONGODB_URI/i)).toHaveCount(0); // no database form or instructions on the site
  await expect(page.getByLabel("TinyFish API key")).toBeVisible(); // the key field is always there

  // Save the TinyFish key. The input is cleared and the key is never echoed back.
  await page.getByLabel("TinyFish API key").fill("test-key");
  await page.getByRole("button", { name: "Save securely" }).first().click();
  await expect(page.getByText("Saved, encrypted at rest").first()).toBeVisible();
  await expect(page.getByLabel("TinyFish API key")).toHaveValue("");
  expect(await (await page.request.get("/api/integrations/status")).text()).not.toContain("test-key");
  await expect(page.getByText("Required integrations verified")).toHaveCount(0); // saved is not the same as verified

  await page.getByRole("button", { name: "Test Search" }).click();
  await expect(page.getByText(/Search returned 3 result/)).toBeVisible();
  await page.getByRole("button", { name: "Test Fetch" }).click();
  await expect(page.getByText(/Fetch extracted/)).toBeVisible();
  await expect(page.getByText("Required integrations verified")).toBeVisible();
  await page.getByRole("button", { name: "Test Browser" }).click();
  await expect(page.getByText(/Browser session created and terminated/)).toBeVisible();

  // Gemini (optional)
  const g = page.locator("section", { hasText: "Gemini: evidence synthesis" });
  await g.getByLabel("Gemini API key").fill("test-gemini-key");
  await g.getByRole("button", { name: "Save securely" }).click();
  await g.getByRole("button", { name: "Test connection" }).click();
  await expect(g.getByText(/Key, model access and generation all verified/)).toBeVisible();

  // Their audits now work using THEIR key: the mock saw their key in the header, never in a URL.
  const reqs = await mockRequests(request);
  expect(reqs.find((r) => r.path.startsWith("/search"))?.headers["x-api-key"]).toBe("test-key");
  expect(reqs.every((r) => !r.path.includes("test-key"))).toBe(true);
  await page.goto("/audit/new");
  await expect(page.getByRole("button", { name: "Run an audit" })).toBeEnabled();

  // A wrong key fails honestly (the mock rejects anything but test-key).
  await page.goto("/setup");
  await page.getByLabel("TinyFish API key").fill("wrong-key-123456");
  await page.getByRole("button", { name: /Replace|Save securely/ }).first().click();
  await page.getByRole("button", { name: "Test Search" }).click();
  await expect(page.getByText(/rejected the API key/)).toBeVisible();
  await expect(page.getByText("Required integrations verified")).toHaveCount(0);
});
