import { z } from "zod";
import { ApiError, route } from "@/lib/api";
import { canSaveCredentials, clearCredential, saveCredential } from "@/lib/config";
import { clearTests } from "@/lib/db/repo";
import { integrationsStatus } from "@/lib/integrations";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), provider: z.enum(["tinyfish", "gemini"]), apiKey: z.string().trim().min(8).max(400) }),
  z.object({ action: z.literal("remove"), provider: z.enum(["tinyfish", "gemini"]) }),
]);

/**
 * Persists the signed-in user's OWN credential, encrypted (AES-256-GCM, key from CREDENTIAL_ENCRYPTION_KEY, bound to their user id), in MongoDB.
 * The response never contains the secret. MongoDB itself is NOT configurable here: MONGODB_URI is env-only.
 */
export const POST = route({ rate: [10, 60_000], schema: Body }, async ({ user, body }) => {
  if (body.action === "save") {
    const can = canSaveCredentials();
    if (!can.ok) throw new ApiError(409, "cannot_save_securely", `${can.reason} Nothing was saved; ask the server operator to fix this.`);
    await saveCredential(user.userId, body.provider, body.apiKey);
    await clearTests(user.userId, body.provider);
  } else {
    await clearCredential(user.userId, body.provider);
    await clearTests(user.userId, body.provider);
  }
  return integrationsStatus(user.userId);
});
