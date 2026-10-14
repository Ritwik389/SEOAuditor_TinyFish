import { defineConfig, devices } from "@playwright/test";

const port = 4030;
const channel = process.env.PLAYWRIGHT_CHANNEL || "chrome";
export default defineConfig({
  testDir: "./e2e", testMatch: /public-demo\.spec/, timeout: 90000, workers: 1,
  expect: { timeout: 20000 }, reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], channel, baseURL: "http://127.0.0.1:3102", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: [
    { command: "npx tsx scripts/mock-services.mts", port, env: { MOCK_PORT: String(port) }, reuseExistingServer: false },
    { command: "npx next dev -p 3102", url: "http://127.0.0.1:3102", reuseExistingServer: false, timeout: 120000, env: {
      PUBLIC_DEMO_MODE: "true", NEXT_DIST_DIR: ".next-public-e2e", TINYFISH_API_KEY: "test-key", GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-2.5-flash",
      SNIFFSITE_ALLOW_PRIVATE_TARGETS: "1", SNIFFSITE_RATE_LIMIT_MULTIPLIER: "10",
      TINYFISH_SEARCH_URL: `http://127.0.0.1:${port}/search`, TINYFISH_FETCH_URL: `http://127.0.0.1:${port}/fetch`, TINYFISH_AGENT_URL: `http://127.0.0.1:${port}/agent/v1`, GEMINI_BASE_URL: `http://127.0.0.1:${port}/gemini`,
    } },
  ],
});
