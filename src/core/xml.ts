/**
 * XML utility functions
 */

/**
 * Escape special XML characters for safe TwiML embedding.
 *
 * Covers all five XML predefined entities. Apostrophes are included because
 * escaped values are also interpolated into attributes, and an attribute
 * delimited with single quotes would otherwise be terminated early.
 * `&` must be replaced first so the entities emitted below are not re-escaped.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
