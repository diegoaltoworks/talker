/**
 * Structured JSON logger
 *
 * Silent during tests unless DEBUG=true.
 * `debug` is opt-in everywhere, test or not: it only emits when DEBUG=true,
 * the same flag that unsilences tests, so a host enables high-volume
 * diagnostic logging (e.g. per-request content) with one env var rather than
 * a second one to learn.
 * Automatically redacts phone numbers (recursively, by key name, including
 * inside an array of raw phone strings) and previews every other string
 * field to a fixed length once it exceeds that length - a value at or under
 * the preview length logs in full, verbatim (see SECURITY.md). Set
 * TALKER_LOG_VERBOSE=true to log full, untruncated content instead of the
 * preview (phone redaction, and any field named in TALKER_LOG_REDACT_KEYS,
 * still apply).
 */

import { UNKNOWN_PHONE_NUMBER } from "./defaults";
import { truncateGraphemeSafe } from "./text";

type LogLevel = "debug" | "info" | "warn" | "error";

const PHONE_KEYS = new Set(["phoneNumber", "phone", "From", "To", "from", "to"]);
const REDACTED_PLACEHOLDER = "[redacted]";
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

function isDebugEnabled(): boolean {
  return process.env.DEBUG === "true";
}

/**
 * Whether a log at `level` actually emits, given the silence/debug policy.
 * Pure and exported so the "debug is suppressed outside DEBUG=true" case can
 * be tested directly: `isTestEnv()`'s argv half is fixed at module load (see
 * above), so under `bun test` it is always true, and `isSilent()` already
 * swallows every level whenever `DEBUG` isn't `"true"` - there is no way to
 * observe this function's non-test branch by spying on `console.log` from
 * within the suite.
 */
export function isLevelEnabled(
  level: LogLevel,
  opts: { silent: boolean; debugEnabled: boolean },
): boolean {
  if (opts.silent) return false;
  if (level === "debug" && !opts.debugEnabled) return false;
  return true;
}

/**
 * Field names to redact outright, in addition to the built-in phone
 * redaction - opt-in for a host whose flow params or custom fields carry
 * something more sensitive than ordinary conversation text (an email, a
 * booking reference). Comma-separated, e.g.
 * `TALKER_LOG_REDACT_KEYS=email,reference`. Read fresh on every call rather
 * than cached at module load, matching TALKER_LOG_VERBOSE and every other
 * env-driven policy here, and so a test can change it between assertions.
 */
function redactKeys(): Set<string> {
  const raw = process.env.TALKER_LOG_REDACT_KEYS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  );
}

const timestamp = () => new Date().toISOString();

/**
 * Redact a phone number, keeping only the last 4 digits.
 * E.g. "+15551234567" -> "***4567"
 */
export function redactPhone(phone: string): string {
  if (!phone || phone === UNKNOWN_PHONE_NUMBER) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "***";
  return `***${digits.slice(-4)}`;
}

/**
 * Preview a string field by policy: truncated to a fixed length by default,
 * full text when TALKER_LOG_VERBOSE=true. Applied to every string value
 * logged (other than diagnostic keys, see UNTRUNCATED_KEYS) so conversation
 * content (user messages, LLM output, extracted flow params) never lands
 * verbatim by accident. Grapheme-cluster-safe: a preview boundary that would
 * split a surrogate pair (an emoji, most non-BMP text) drops the whole
 * cluster instead of leaving a lone surrogate in the JSON output.
 */
function redactContent(text: string): string {
  if (isVerbose() || text.length <= CONTENT_PREVIEW_LENGTH) return text;
  return `${truncateGraphemeSafe(text, CONTENT_PREVIEW_LENGTH)}...`;
}

/**
 * Redact a single string value by the policy its key implies. `key` is the
 * same for a top-level field and for each element of an array under that
 * field (redactValue re-invokes this per array element with the array's own
 * key, not a per-element one) - so `{ phoneNumber: ["+1...", "+1..."] }`
 * phone-redacts every element the same way `{ phoneNumber: "+1..." }` would,
 * rather than falling through to the length-preview policy the way a plain
 * `typeof value === "string"` check keyed only on depth 0 used to.
 */
function redactString(key: string, value: string): string {
  if (PHONE_KEYS.has(key)) return redactPhone(value);
  return UNTRUNCATED_KEYS.has(key) ? value : redactContent(value);
}

function redactValue(
  key: string,
  value: unknown,
  depth: number,
  keysToRedact: Set<string>,
): unknown {
  if (depth >= MAX_REDACT_DEPTH) return "[max depth exceeded]";
  // Checked ahead of every type-specific branch below (string, Date, Error,
  // array, object) so a named key is redacted outright no matter what shape
  // its value takes - an object-valued flow param (`{ extracted: { email:
  // ... } }` logged whole) or a number must not slip through just because
  // only the string branch used to check this.
  if (keysToRedact.has(key)) return REDACTED_PLACEHOLDER;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return redactString(key, value);
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(key, item, depth + 1, keysToRedact));
  }
  if (value && typeof value === "object") {
    return redactData(value as Record<string, unknown>, depth + 1, keysToRedact);
  }
  return value;
}

/**
 * Redact sensitive/verbose fields in log data, recursively.
 * Fields named "phoneNumber", "phone", "From"/"from" or "To"/"to" (at any
 * depth, including inside an array of raw phone strings) are phone-redacted;
 * fields named in TALKER_LOG_REDACT_KEYS are replaced outright; every other
 * string field is content-previewed. "from"/"to" are generic enough that a
 * non-phone value under either key (a short code, a language tag) still
 * redacts to "***" with no warning - prefer a different key name for a
 * "from"/"to" pair that is not a phone number.
 */
function redactData(
  data: Record<string, unknown>,
  depth: number,
  keysToRedact: Set<string>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    redacted[key] = redactValue(key, value, depth, keysToRedact);
  }
  return redacted;
}

const log = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
  if (!isLevelEnabled(level, { silent: isSilent(), debugEnabled: isDebugEnabled() })) return;
  const entry = {
    timestamp: timestamp(),
    level,
    message,
    ...(data ? redactData(data, 0, redactKeys()) : undefined),
  };
  console.log(JSON.stringify(entry));
};

export const logger = {
  debug: (message: string, data?: Record<string, unknown>) => log("debug", message, data),
  info: (message: string, data?: Record<string, unknown>) => log("info", message, data),
  warn: (message: string, data?: Record<string, unknown>) => log("warn", message, data),
  error: (message: string, data?: Record<string, unknown>) => log("error", message, data),
};
