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
}

const pendingQueries = new Map<string, PendingQuery>();

export function setPending(phoneNumber: string, query: PendingQuery): void {
  pendingQueries.set(phoneNumber, query);
}

export function getPending(phoneNumber: string): PendingQuery | undefined {
  return pendingQueries.get(phoneNumber);
}

export function deletePending(phoneNumber: string): void {
  pendingQueries.delete(phoneNumber);
}
