import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const MOCK_BASE = "http://127.0.0.1:4020";
const CONTROL = "http://127.0.0.1:4021";
export const PASSWORD = "e2e-password-long-enough";

export async function mockReset(request: APIRequestContext) {
  await request.post(`${CONTROL}/__reset`, { data: {} });
}
export async function mockSet(request: APIRequestContext, patch: Record<string, unknown>) {
  await request.post(`${CONTROL}/__set`, { data: patch });
}
export async function mockRequests(request: APIRequestContext): Promise<{ method: string; path: string; headers: Record<string, string> }[]> {
  return (await request.post(`${CONTROL}/__requests`, { data: {} })).json();
}

/** Real UI sign-up. New accounts land on the Setup page, where they add their own keys. */
export async function signUpUi(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login?mode=signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/setup/);
}

/** Saves this account's own mock keys through the same endpoint the Setup page uses. */
export async function saveKeys(page: Page) {
  for (const [provider, apiKey] of [["tinyfish", "test-key"], ["gemini", "test-gemini-key"]] as const) {
    const r = await page.request.post("/api/integrations/configure", { data: { action: "save", provider, apiKey } });
    expect(r.ok()).toBe(true);
  }
}

export const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

/** The session cookie comes from the setup project's storageState. */
export async function login(page: Page) {
  await page.goto("/audit/new");
  await expect(page).toHaveURL(/\/audit\/new/);
}

/** Starts an audit against the mock "target site" and returns once the audit page is showing. */
export async function startAudit(page: Page, opts: { query?: string; verification?: "auto" | "always" | "off" } = {}) {
  await page.goto("/audit/new");
  await page.getByLabel(/Target page URL/).fill(`${MOCK_BASE}/pricing`);
  if (opts.query !== undefined) await page.getByLabel("Primary search query").fill(opts.query);
  if (opts.verification) await page.getByRole("radio", { name: new RegExp(`^${{ auto: "Automatic", always: "Always", off: "Off" }[opts.verification]}`) }).check();
  await page.getByRole("button", { name: "Run an audit" }).click();
  await expect(page).toHaveURL(/\/audit\/[0-9a-f]{16}$/);
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page should not scroll horizontally").toBeLessThanOrEqual(1);
}

/** Next.js injects its own role=alert route announcer; exclude it. */
export const alertOf = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
