type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

const SENSITIVE_KEY =
  /(authorization|cookie|password|secret|token|api[-_]?key|access[-_]?key|hmac|payload|body)/i;
const CONNECTION_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const BEARER_TOKEN = /\bBearer\s+[^\s]+/gi;

function redactString(value: string): string {
  return value
    .replace(CONNECTION_CREDENTIALS, "$1[REDACTED]@")
    .replace(BEARER_TOKEN, "Bearer [REDACTED]");
}

function redactValue(
  value: unknown,
  seen: WeakSet<object>,
  depth = 0,
): unknown {
  if (depth > 5) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }

  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key)
        ? "[REDACTED]"
        : redactValue(item, seen, depth + 1),
    ]),
  );
}

function write(level: LogLevel, event: string, fields: LogFields = {}): void {
  const entry = redactValue(
    {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    },
    new WeakSet(),
  );
  const line = JSON.stringify(entry);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.info(line);
}

export const logger = {
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};

