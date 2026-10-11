import { json, route } from "@/lib/api";
import { sessionCookie } from "@/lib/security/auth";

export const POST = route({ auth: false }, async () => json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) }));
