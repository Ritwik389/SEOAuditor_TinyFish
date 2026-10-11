import { test as setup } from "@playwright/test";
import { saveKeys, signUpUi } from "./helpers";

// Creates the account used by most tests, through the real sign-up UI, and gives it its own (mock) keys.
setup("create a user with their own keys", async ({ page }) => {
  await signUpUi(page, "alice@example.com");
  await saveKeys(page);
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
