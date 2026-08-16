/**
 * Call route paths, single-sourced between `core/twiml.ts` (which builds the
 * `action`/`Redirect` URLs Twilio calls back into) and `callRoutes`
 * (`src/routes/call/index.ts`, which registers the same paths as Hono
 * routes) so renaming one can't drift from the other. Kept dependency-free
 * (no hono import) so it stays a plain constants module either side can pull
 * in without pulling in the other's concerns.
 */

export const CALL_PATH = "/call";
export const CALL_RESPOND_PATH = "/call/respond";
export const CALL_ANSWER_PATH = "/call/answer";
export const CALL_NO_SPEECH_PATH = "/call/no-speech";
export const CALL_STATUS_PATH = "/call/status";
