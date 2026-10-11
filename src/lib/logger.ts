import { redact } from "./security/redact";

type Level = "debug" | "info" | "warn" | "error";

export function log(level: Level, msg: string, ctx: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "test" && !process.env.LOG_IN_TEST) return;
  const line = redact({ t: new Date().toISOString(), level, msg, ...ctx });
  (level === "error" ? console.error : console.log)(line);
}
