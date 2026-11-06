import "server-only";

// Structured JSON logger (requirements/02 §8.3, NFR-OBS-001).
// Rules: no PII values, no secrets, no record contents. IDs (requestId, tenantId,
// agencyId, uid) are pseudonymous and allowed. Known sensitive keys are redacted
// defensively, but callers must still avoid passing sensitive data.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SEVERITY: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
};

const REDACTED = "[redacted]";
const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|private_?key|api_?key|session|credential|email|phone|^ip$|ip_?addr|user_?agent/i;

// Values are scrubbed too (T-09-08): third-party error messages can embed an email address or a
// token, whatever key they arrive under.
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[jwt]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    "[private-key]",
  ],
];

export function scrub(value: string): string {
  let out = value;
  for (const [pattern, replacement] of VALUE_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

const MAX_STRING = 500;
const MAX_DEPTH = 4;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const clean = scrub(value);
    return clean.length > MAX_STRING ? `${clean.slice(0, MAX_STRING)}…` : clean;
  }
  if (typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(inner, depth + 1);
  }
  return out;
}

function serializeError(error: Error): Record<string, unknown> {
  const code = (error as { code?: unknown }).code;
  return {
    name: error.name,
    message: scrub(error.message).slice(0, MAX_STRING),
    ...(code !== undefined ? { code } : {}),
  };
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export function createLogger(
  options: {
    level?: LogLevel;
    bindings?: LogFields;
    write?: (line: string, level: LogLevel) => void;
  } = {},
): Logger {
  const minLevel = options.level ?? (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";
  const bindings = options.bindings ?? {};
  const write =
    options.write ??
    ((line: string, level: LogLevel) =>
      level === "error" || level === "warn" ? console.error(line) : console.log(line));

  const emit = (level: LogLevel, message: string, fields?: LogFields) => {
    if (LEVEL_ORDER[level] < (LEVEL_ORDER[minLevel] ?? LEVEL_ORDER.info)) return;
    const entry = {
      severity: SEVERITY[level],
      message: scrub(message),
      time: new Date().toISOString(),
      ...(redact(bindings) as LogFields),
      ...(redact(fields ?? {}) as LogFields),
    };
    write(JSON.stringify(entry), level);
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (extra) =>
      createLogger({ ...options, level: minLevel, bindings: { ...bindings, ...extra } }),
  };
}

export const logger = createLogger();
