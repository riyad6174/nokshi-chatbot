type LogLevel = "debug" | "info" | "warn" | "error";

const REDACTED = "[redacted]";
const SENSITIVE_KEY = /(api[_-]?key|secret|token|password|authorization|cookie|card|otp|pin)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limit]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redact(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(entry, depth + 1);
    }
    return output;
  }
  if (typeof value === "string" && value.length > 1000) {
    return `${value.slice(0, 1000)}...`;
  }
  return value;
}

function emit(level: LogLevel, event: string, meta?: Record<string, unknown>) {
  const payload = {
    level,
    event,
    at: new Date().toISOString(),
    ...(meta ? { meta: redact(meta) } : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (event: string, meta?: Record<string, unknown>) => emit("debug", event, meta),
  info: (event: string, meta?: Record<string, unknown>) => emit("info", event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => emit("warn", event, meta),
  error: (event: string, meta?: Record<string, unknown>) => emit("error", event, meta),
};
