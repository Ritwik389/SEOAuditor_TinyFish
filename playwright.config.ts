import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a REAL Next.js server, with TinyFish/Gemini replaced by local mock services
// and the in-memory (non-durable) store. No paid API and no real database is ever touched.
// Uses the installed Microsoft Edge so no browser download is needed.
const MOCK = 4020;
const channel = process.env.PLAYWRIGHT_CHANNEL || "msedge";
const env = {
  PUBLIC_DEMO_MODE: "false",
  SNIFFSITE_STORE: "memory",
  SNIFFSITE_ALLOW_PRIVATE_TARGETS: "1",
  SNIFFSITE_RATE_LIMIT_MULTIPLIER: "10", // the suite signs up and audits a lot; real limits are covered by unit tests
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  SESSION_SECRET: "e2e-session-secret",
  TINYFISH_SEARCH_URL: `http://127.0.0.1:${MOCK}/search`,
  TINYFISH_FETCH_URL: `http://127.0.0.1:${MOCK}/fetch`,
  TINYFISH_BROWSER_URL: `http://127.0.0.1:${MOCK}/browser`,
  TINYFISH_AGENT_URL: `http://127.0.0.1:${MOCK}/agent/v1`,
  GEMINI_BASE_URL: `http://127.0.0.1:${MOCK}/gemini`,
  // The server must work with NO shared keys: every user brings their own.
  TINYFISH_API_KEY: "",
  GEMINI_API_KEY: "",
  NEXT_DIST_DIR: ".next-e2e",
};
const base = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { channel, trace: "retain-on-failure", screenshot: "only-on-failure", baseURL: base },
  projects: [
    { name: "setup", use: { ...devices["Desktop Edge"], channel }, testMatch: /auth\.setup/ },
    // Tests that start from a signed-in account that already has its own keys:
    { name: "desktop", dependencies: ["setup"], use: { ...devices["Desktop Edge"], channel, storageState: "e2e/.auth/user.json" }, testMatch: /(app|insights)\.spec/ },
    { name: "mobile", dependencies: ["setup"], use: { ...devices["Pixel 7"], channel, storageState: "e2e/.auth/user.json" }, testMatch: /mobile/ },
    // Tests that bring their own (anonymous / fresh) accounts:
    { name: "accounts", dependencies: ["desktop"], use: { ...devices["Desktop Edge"], channel }, testMatch: /(auth|onboarding|isolation)\.spec/ },
  ],
  webServer: [
    { command: "npx tsx scripts/mock-services.mts", port: MOCK, env: { MOCK_PORT: String(MOCK) }, reuseExistingServer: false, timeout: 60_000 },
    { command: "npx next dev -p 3100", url: `${base}/login`, env, reuseExistingServer: false, timeout: 120_000 },
  ],
});
