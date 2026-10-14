import { z } from "zod";
import { ApiError, json, route } from "@/lib/api";
import { authReady, issueToken, sessionCookie, signIn } from "@/lib/security/auth";
import { publicDemoEnabled } from "@/lib/public-demo";

export const POST = route({ auth: false, rate: [8, 60_000], schema: z.object({ email: z.string().min(3).max(254), password: z.string().min(1).max(200) }) }, async ({ body }) => {
  if (publicDemoEnabled()) throw new ApiError(410, "accounts_disabled", "This demo does not use accounts. Run an audit directly.");
  const ready = authReady();
  if (!ready.ok) throw new ApiError(503, "auth_not_configured", ready.reason!);
  const user = await signIn(body.email, body.password);
  // One message for unknown email and wrong password, so accounts cannot be enumerated.
  if (!user) throw new ApiError(401, "bad_credentials", "Incorrect email or password.");
  const t = issueToken(user.userId);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(t.value, t.maxAge) });
});
