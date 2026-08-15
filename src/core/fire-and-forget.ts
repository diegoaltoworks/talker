/**
 * Fire-and-forget
 *
 * Runs a callback without blocking the caller. Used for hooks that must
 * never affect the response Twilio (or the caller) is waiting on -
 * `onMessage` and `onMessageStatus` both fire this way.
 */

export function fireAndForget(
  run: () => void | Promise<void>,
  onError: (error: unknown) => void,
): void {
  Promise.resolve().then(run).catch(onError);
}
