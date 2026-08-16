/**
 * XML utility functions
 */

/**
 * C0 control characters other than tab (\x09), LF (\x0A) and CR (\x0D) are
 * not valid anywhere in XML 1.0 content - no entity escapes them, so a
 * document containing one is malformed regardless of the entity-replacement
 * below. STT transcripts and SMS bodies can carry them (stray control bytes
 * from a codec, a copy-pasted binary blob), so they are stripped rather than
 * passed through to Twilio, which would otherwise drop the call on a parse
 * error.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching XML-invalid control chars is the point
const XML_INVALID_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

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
    .replace(XML_INVALID_CONTROL_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
