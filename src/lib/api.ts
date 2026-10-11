import { z } from "zod";
import { StoreNotConfigured } from "./db/mongo";
import { log } from "./logger";
import { redact } from "./security/redact";
import { UrlRejected } from "./security/ssrf";
import { authReady, tokenFromRequest, verifyToken, type SessionUser } from "./security/auth";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

// ---- Rate limiting: sliding window, per process. ------------------------------------------
// ponytail: process-local; on serverless each warm instance counts separately. Move to a shared
// store if you need a hard global limit.
const g = globalThis as unknown as { __sniffRl?: Map<string, number[]> };
export function rateLimit(key: string, limit: number, windowMs: number): number | null {
  const m: Map<string, number[]> = (g.__sniffRl ??= new Map());
  const now = Date.now();
  const hits = (m.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    m.set(key, hits);
    return Math.ceil((windowMs - (now - hits[0]!)) / 1000);
  }
  hits.push(now);
  m.set(key, hits);
  if (m.size > 5000) for (const [k, v] of m) if (!v.some((t) => now - t < windowMs)) m.delete(k);
  return null;
}

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
    } catch {
      return false;
    }
  }
  return req.headers.get("sec-fetch-site") !== "cross-site";
}

interface Cfg<S extends z.ZodTypeAny> {
  /** Defaults to true: requires a signed-in user. */
  auth?: boolean;
  /** [maxRequests, windowMs] per client IP + route. */
  rate?: [number, number];
  schema?: S;
  maxBytes?: number;
}
export interface Ctx<B> {
  user: SessionUser;
  req: Request;
  params: Record<string, string>;
  body: B;
  ip: string;
}

/** Wraps a route handler with auth, CSRF origin check, rate limit, size limit, validation and safe errors. */
export function route<S extends z.ZodTypeAny = z.ZodUndefined>(cfg: Cfg<S>, handler: (c: Ctx<z.infer<S>>) => Promise<unknown>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> => {
    const started = Date.now();
    const path = new URL(req.url).pathname;
    try {
      const ip = clientIp(req);
      let user: SessionUser = { userId: "" };
      if (cfg.auth !== false) {
        const ready = authReady();
        if (!ready.ok) throw new ApiError(503, "auth_not_configured", ready.reason!);
        const s = verifyToken(tokenFromRequest(req));
        if (!s) throw new ApiError(401, "unauthorized", "Sign in required.");
        user = s;
      }
      if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) throw new ApiError(403, "bad_origin", "Cross-origin request rejected.");
      const [limit, win] = cfg.rate ?? [120, 60_000];
      const mult = process.env.NODE_ENV === "production" ? 1 : Number(process.env.SNIFFSITE_RATE_LIMIT_MULTIPLIER) || 1; // test-only knob
      const wait = rateLimit(`${ip}:${req.method}:${path.replace(/[0-9a-f]{16}/g, ":id")}`, limit * mult, win);
      if (wait !== null) return json({ error: { code: "rate_limited", message: `Too many requests. Try again in ${wait}s.` } }, 429, { "retry-after": String(wait) });

      let body: unknown = undefined;
      if (cfg.schema) {
        const text = await req.text();
        if (text.length > (cfg.maxBytes ?? 32_768)) throw new ApiError(413, "too_large", "Request body too large.");
        let raw: unknown;
        try {
          raw = text ? JSON.parse(text) : {};
        } catch {
          throw new ApiError(400, "bad_json", "Request body must be valid JSON.");
        }
        const parsed = cfg.schema.safeParse(raw);
        if (!parsed.success) throw new ApiError(400, "invalid_request", parsed.error.issues.slice(0, 3).map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join("; "));
        body = parsed.data;
      }
      const out = await handler({ user, req, params: await ctx.params, body: body as z.infer<S>, ip });
      return out instanceof Response ? out : json(out);
    } catch (e) {
      const res = toResponse(e);
      log(res.status >= 500 ? "error" : "warn", "api error", { path, method: req.method, status: res.status, ms: Date.now() - started, err: res.status >= 500 ? redact(e) : undefined });
      return res;
    }
  };
}

function toResponse(e: unknown): Response {
  if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message } }, e.status);
  if (e instanceof UrlRejected) return json({ error: { code: "url_rejected", message: e.message } }, 400);
  if (e instanceof StoreNotConfigured) return json({ error: { code: "db_not_configured", message: e.message } }, 503);
  return json({ error: { code: "internal_error", message: "Something went wrong on the server." } }, 500);
}
