import { expect, test } from "@playwright/test";
import { PASSWORD, alertOf, signUpUi, uniqueEmail } from "./helpers";

test("anonymous visitors are sent to sign in, and APIs refuse them", async ({ page, request }) => {
  await page.goto("/audit/new?url=https://example.com/x");
  await expect(page).toHaveURL(/\/login\?next=/);
  for (const p of ["/api/audits", "/api/integrations/status", "/api/settings"]) expect((await request.get(p)).status()).toBe(401);
  expect((await request.post("/api/audits", { data: { url: "https://example.com", queries: [] } })).status()).toBe(401);
});

test("sign up, sign out, sign in; wrong credentials give one generic message; return-to is preserved", async ({ page }) => {
  const email = uniqueEmail("auth");
  await signUpUi(page, email);
  await page.getByRole("link", { name: "New audit" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:3100\/$/); // sign-out finished (cookie cleared) before we navigate
  await page.goto("/audit/new?url=https://example.com/x");
  await expect(page).toHaveURL(/\/login\?next=/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(alertOf(page)).toHaveText("Incorrect email or password.");

  await page.getByLabel("Email").fill("nobody-" + email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(alertOf(page)).toHaveText("Incorrect email or password."); // same message: no account enumeration

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page).toHaveURL(/\/audit\/new\?url=/);
  await expect(page.getByLabel(/Target page URL/)).toHaveValue("https://example.com/x");
});

test("sign-up validates email and password length and rejects duplicates", async ({ page }) => {
  await page.goto("/login?mode=signup");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel(/^Password/).fill("long-enough-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(alertOf(page)).toContainText("valid email");

  await page.getByLabel("Email").fill(uniqueEmail("short"));
  await page.getByLabel(/^Password/).fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(alertOf(page)).toContainText("10 characters");

  await page.getByLabel("Email").fill("alice@example.com"); // created by the setup project
  await page.getByLabel(/^Password/).fill("long-enough-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(alertOf(page)).toContainText("already exists");
});

test("cross-origin writes are rejected", async ({ page }) => {
  await signUpUi(page, uniqueEmail("csrf"));
  const r = await page.request.post("/api/audits", { headers: { origin: "https://evil.example" }, data: { url: "https://example.com" } });
  expect(r.status()).toBe(403);
});
