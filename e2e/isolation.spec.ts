import { expect, test } from "@playwright/test";
import { MOCK_BASE, mockReset, saveKeys, signUpUi, uniqueEmail } from "./helpers";

// Two real accounts, two browser contexts: one user must never see or touch the other's data.
test("users are isolated: audits, reports, history, settings and keys", async ({ browser }) => {
  const a = await (await browser.newContext({ baseURL: "http://127.0.0.1:3100" })).newPage();
  const b = await (await browser.newContext({ baseURL: "http://127.0.0.1:3100" })).newPage();
  await mockReset(a.request);

  await signUpUi(a, uniqueEmail("iso-a"));
  await saveKeys(a);
  await signUpUi(b, uniqueEmail("iso-b"));

  const created = await a.request.post("/api/audits", { data: { url: `${MOCK_BASE}/pricing`, queries: [{ text: "product analytics pricing", source: "user" }], verification: "off", label: "Alice private audit" } });
  expect(created.ok()).toBe(true);
  const { auditId } = await created.json();
  await expect.poll(async () => (await (await a.request.get(`/api/audits/${auditId}`)).json()).audit.status, { timeout: 45_000 }).toMatch(/completed|partial/);

  // Bob cannot read it through any route, and gets "not found" rather than "forbidden" (no existence leak).
  for (const path of [`/api/audits/${auditId}`, `/api/audits/${auditId}/events`, `/api/audits/${auditId}/report`]) expect((await b.request.get(path)).status()).toBe(404);
  expect((await b.request.post(`/api/audits/${auditId}/cancel`)).status()).toBe(404);
  expect((await b.request.post(`/api/audits/${auditId}/retry`)).status()).toBe(404);
  expect((await b.request.delete(`/api/audits/${auditId}`)).status()).toBe(404);
  expect((await b.goto(`/audit/${auditId}`))!.status()).toBe(404);
  expect((await b.goto(`/audit/${auditId}/report`))!.status()).toBe(404);

  // Bob's history and search never include Alice's audit; Alice's is intact.
  const list = await (await b.request.get("/api/audits?q=pricing")).json();
  expect(list.total).toBe(0);
  await b.goto("/history");
  await expect(b.getByText("No audits yet")).toBeVisible();
  await expect(b.locator("body")).not.toContainText("Alice private audit");
  expect((await a.request.get(`/api/audits/${auditId}`)).status()).toBe(200);

  // Bob has no key (Alice's key is not shared) and cannot run a live audit with it.
  const st = await (await b.request.get("/api/integrations/status")).json();
  expect(st.tinyfish.configured).toBe(false);
  expect((await b.request.post("/api/audits", { data: { url: `${MOCK_BASE}/pricing`, queries: [] } })).status()).toBe(409);

  // Settings are per account.
  await a.request.patch("/api/settings", { data: { retentionDays: 45 } });
  expect((await (await b.request.get("/api/settings")).json()).settings.retentionDays).toBe(0);
  expect((await (await a.request.get("/api/settings")).json()).settings.retentionDays).toBe(45);
});
