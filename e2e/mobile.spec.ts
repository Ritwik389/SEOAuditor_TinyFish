import { expect, test } from "@playwright/test";
import { login, mockReset, noHorizontalOverflow, startAudit } from "./helpers";

test.beforeEach(async ({ request }) => mockReset(request));

test("mobile: landing, demo report, audit form, setup and live report have no horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await noHorizontalOverflow(page);
  await expect(page.getByLabel("Page URL")).toBeVisible();

  await page.goto("/demo/saas-pricing");
  await noHorizontalOverflow(page);
  await expect(page.getByRole("navigation", { name: "Report sections" })).toBeVisible();

  await login(page);
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: /Open menu/ }).click();
  await expect(page.getByRole("link", { name: "History" })).toBeVisible();
  await page.getByRole("link", { name: "Setup" }).click();
  await expect(page.getByRole("heading", { name: /Setup/ }).first()).toBeVisible();
  await noHorizontalOverflow(page);

  await startAudit(page, { query: "product analytics pricing", verification: "off" });
  await expect(page.getByRole("heading", { name: "Executive summary" })).toBeVisible({ timeout: 45_000 });
  await noHorizontalOverflow(page);
  // inputs must be usable at phone width: 16px font avoids iOS zoom, 44px targets
  await page.goto("/audit/new");
  const h = await page.getByLabel(/Target page URL/).evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(44);
});
