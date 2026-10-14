import { z } from "zod";
import { ApiError, json, route } from "@/lib/api";
import { authReady, issueToken, sessionCookie, signUp } from "@/lib/security/auth";
import { publicDemoEnabled } from "@/lib/public-demo";

// Anyone can create their own account; each account only ever sees its own audits and uses its own API keys.
export const POST = route({ auth: false, rate: [5, 60_000], schema: z.object({ email: z.string().min(3).max(254), password: z.string().min(1).max(200) }) }, async ({ body }) => {
  if (publicDemoEnabled()) throw new ApiError(410, "accounts_disabled", "This demo does not use accounts. Run an audit directly.");
  if (process.env.SIGNUPS_ENABLED === "false") throw new ApiError(403, "signups_disabled", "New sign-ups are disabled on this server.");
  const ready = authReady();
  if (!ready.ok) throw new ApiError(503, "auth_not_configured", ready.reason!);
  const r = await signUp(body.email, body.password);
  if ("error" in r) throw new ApiError(400, "invalid_signup", r.error);
  const t = issueToken(r.user.userId);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(t.value, t.maxAge) });
});
