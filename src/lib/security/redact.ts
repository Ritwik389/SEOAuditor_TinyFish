// Secret redaction for logs and any message that might reach a client.
const PATTERNS: [RegExp, string][] = [
  [/mongodb(\+srv)?:\/\/[^\s"'<>]+/gi, "mongodb://[REDACTED]"],
  [/(x-api-key|x-goog-api-key|authorization)["']?\s*[:=]\s*["']?[^\s"',;]+/gi, "$1: [REDACTED]"],
  [/([?&](key|api_key|apikey|token)=)[^&\s"']+/gi, "$1[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [REDACTED]"],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_GOOGLE_KEY]"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_KEY]"],
];

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export function redact(input: unknown): string {
  let s = typeof input === "string" ? input : input instanceof Error ? input.message : safeJson(input);
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s;
}

const SECRET_KEYS = /(key|secret|password|token|uri|authorization|cookie)/i;
export function redactObject<T>(obj: T, depth = 0): T {
  if (depth > 6 || obj === null || typeof obj !== "object") return typeof obj === "string" ? (redact(obj) as T) : obj;
  if (Array.isArray(obj)) return obj.map((v) => redactObject(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? "[REDACTED]" : redactObject(v, depth + 1);
  }
  return out as T;
}
