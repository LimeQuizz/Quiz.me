/**
 * Structured JSON logger. Fields that could carry personal data or user
 * content are dropped at info level and below, whatever the caller passes.
 */

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEYS = new Set([
  "email",
  "name",
  "filename",
  "fileName",
  "sourceFilename",
  "front",
  "back",
  "options",
  "content",
  "text",
  "token",
  "sessionToken",
  "secret",
  "providerAccountId",
]);

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
  return ORDER[lvl] ?? ORDER.info;
}

export function sanitize(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_KEYS.has(k)) continue;
    if (v instanceof Error) out[k] = v.name;
    else if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[k] = v;
  }
  return out;
}

function emit(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...sanitize(fields) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
