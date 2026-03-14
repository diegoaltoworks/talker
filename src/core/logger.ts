/**
 * Structured JSON logger
 *
 * Silent during tests unless DEBUG=true.
 * Automatically redacts phone numbers in structured log data.
 */

type LogLevel = "info" | "warn" | "error";

const isTestEnv =
  process.env.NODE_ENV === "test" ||
  (typeof Bun !== "undefined" && process.argv.some((arg) => arg.includes("test")));
const isDebug = process.env.DEBUG === "true";
const isSilent = isTestEnv && !isDebug;

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
 * Redact sensitive fields in log data.
 * Redacts any field named "phoneNumber" or "phone".
 */
function redactData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return data;

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if ((key === "phoneNumber" || key === "phone") && typeof value === "string") {
      redacted[key] = redactPhone(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

const log = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
  if (isSilent) return;
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
