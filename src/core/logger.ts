/**
 * Structured JSON logger
 *
 * Silent during tests unless DEBUG=true.
 * Automatically redacts phone numbers (recursively, by key name) and
 * previews long string fields by policy; set TALKER_LOG_VERBOSE=true to log
 * full content (see SECURITY.md).
 */

type LogLevel = "info" | "warn" | "error";

const PHONE_KEYS = new Set(["phoneNumber", "phone"]);
/** Diagnostic fields, not conversation content - never preview-truncated. */
const UNTRUNCATED_KEYS = new Set(["error", "stack"]);
const CONTENT_PREVIEW_LENGTH = 160;
/** Recursion cap on redactData: cheap insurance against a circular payload. */
const MAX_REDACT_DEPTH = 8;

// process.argv cannot change at runtime, so this half of isTestEnv is fixed at load.
const isTestArgv = typeof Bun !== "undefined" && process.argv.some((arg) => arg.includes("test"));

function isTestEnv(): boolean {
  return process.env.NODE_ENV === "test" || isTestArgv;
}

function isSilent(): boolean {
  return isTestEnv() && process.env.DEBUG !== "true";
}

function isVerbose(): boolean {
  return process.env.TALKER_LOG_VERBOSE === "true";
}

const timestamp = () => new Date().toISOString();

/**
 * Redact a phone number, keeping only the last 4 digits.
 * E.g. "+15551234567" -> "***4567"
 */
export function redactPhone(phone: string): string {
  if (!phone || phone === "unknown") return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "***";
  return `***${digits.slice(-4)}`;
}

/**
 * Preview a string field by policy: truncated to a fixed length by default,
 * full text when TALKER_LOG_VERBOSE=true. Applied to every string value
 * logged (other than diagnostic keys, see UNTRUNCATED_KEYS) so conversation
 * content (user messages, LLM output, extracted flow params) never lands
 * verbatim by accident.
 */
function redactContent(text: string): string {
  if (isVerbose() || text.length <= CONTENT_PREVIEW_LENGTH) return text;
  return `${text.slice(0, CONTENT_PREVIEW_LENGTH)}...`;
}

function redactValue(key: string, value: unknown, depth: number): unknown {
  if (depth >= MAX_REDACT_DEPTH) return "[max depth exceeded]";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return UNTRUNCATED_KEYS.has(key) ? value : redactContent(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(key, item, depth + 1));
  if (value && typeof value === "object") {
    return redactData(value as Record<string, unknown>, depth + 1);
  }
  return value;
}

/**
 * Redact sensitive/verbose fields in log data, recursively.
 * Fields named "phoneNumber" or "phone" (at any depth) are phone-redacted;
 * every other string field is content-previewed.
 */
function redactData(
  data?: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> | undefined {
  if (!data) return data;

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (PHONE_KEYS.has(key) && typeof value === "string") {
      redacted[key] = redactPhone(value);
    } else {
      redacted[key] = redactValue(key, value, depth);
    }
  }
  return redacted;
}

const log = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
  if (isSilent()) return;
  const entry = {
    timestamp: timestamp(),
    level,
    message,
    ...redactData(data),
  };
  console.log(JSON.stringify(entry));
};

export const logger = {
  info: (message: string, data?: Record<string, unknown>) => log("info", message, data),
  warn: (message: string, data?: Record<string, unknown>) => log("warn", message, data),
  error: (message: string, data?: Record<string, unknown>) => log("error", message, data),
};
