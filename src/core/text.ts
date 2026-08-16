/**
 * Grapheme-safe text truncation, shared by every site in the codebase that
 * caps a string at a maximum length: input sanitization (SpeechResult,
 * Body), voice text limits (transcription, synthesis), and the logger's
 * content preview.
 */

// Constructing an Intl.Segmenter isn't free (it loads ICU grapheme-break
// data) - shared across calls rather than rebuilt per truncateGraphemeSafe call.
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Truncate a string to the max length, grapheme-cluster-safe.
 *
 * A plain `substring(0, maxLength)` counts UTF-16 code units, so a cut that
 * lands inside a surrogate pair (any character outside the Basic Multilingual
 * Plane - most emoji) or between a base character and a combining mark
 * leaves a lone surrogate or an orphaned combining character at the end of
 * the string. A lone surrogate is invalid in XML content and reaches TwiML
 * broken; either way playback/display is corrupted. Segmenting by grapheme
 * cluster and only ever dropping a whole cluster avoids both. The result may
 * end up a little shorter than `maxLength` when the boundary cluster doesn't
 * fit - that's the max being honoured, not a bug.
 */
export function truncateGraphemeSafe(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  let result = "";
  for (const { segment } of GRAPHEME_SEGMENTER.segment(input)) {
    if (result.length + segment.length > maxLength) break;
    result += segment;
  }
  return result;
}
