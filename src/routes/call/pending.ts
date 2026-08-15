/**
 * Pending Queries
 *
 * Manages async query state for the "one moment please" acknowledgment pattern.
 * When a query is processing in the background, the pending promise is stored
 * here and resolved when processing completes.
 */

export interface PendingQuery {
  speechResult: string;
  promise: Promise<{ twiml: string }>;
  resolve: (value: { twiml: string }) => void;
  createdAt: number;
}

export type PendingQueryInput = Omit<PendingQuery, "createdAt">;

const pendingQueries = new Map<string, PendingQuery>();

export function setPending(phoneNumber: string, query: PendingQueryInput): void {
  pendingQueries.set(phoneNumber, { ...query, createdAt: Date.now() });
}

export function getPending(phoneNumber: string): PendingQuery | undefined {
  return pendingQueries.get(phoneNumber);
}

export function deletePending(phoneNumber: string): void {
  pendingQueries.delete(phoneNumber);
}

/**
 * Delete pending queries older than `ttlMs`. A caller (Twilio hanging up
 * before requesting /call/answer, a client that never follows the redirect)
 * can leave an entry that nothing ever resolves or deletes; without a sweep
 * it — and its unresolved promise — would leak for the process lifetime.
 */
export function sweepPending(ttlMs: number): void {
  const now = Date.now();
  for (const [phoneNumber, query] of pendingQueries) {
    if (now - query.createdAt > ttlMs) {
      pendingQueries.delete(phoneNumber);
    }
  }
}
