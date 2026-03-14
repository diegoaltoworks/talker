/**
 * Structured JSON logger
 *
 * Silent during tests unless DEBUG=true.
 */

type LogLevel = "info" | "warn" | "error";

const isTestEnv =
  process.env.NODE_ENV === "test" ||
  (typeof Bun !== "undefined" && process.argv.some((arg) => arg.includes("test")));
const isDebug = process.env.DEBUG === "true";
const isSilent = isTestEnv && !isDebug;

const timestamp = () => new Date().toISOString();

const log = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
  if (isSilent) return;
  const entry = {
    timestamp: timestamp(),
    level,
    message,
    ...data,
  };
  console.log(JSON.stringify(entry));
};

export const logger = {
  info: (message: string, data?: Record<string, unknown>) => log("info", message, data),
  warn: (message: string, data?: Record<string, unknown>) => log("warn", message, data),
  error: (message: string, data?: Record<string, unknown>) => log("error", message, data),
};
