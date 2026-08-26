/**
 * `Idempotency-Key` values.
 *
 * Required on every POST that creates or moves money (docs/LLD/api-contracts.md). The header
 * already had a slot in `RequestOptions`; this is what fills it, so the first such endpoint does
 * not invent its own convention.
 *
 * THE KEY IDENTIFIES THE INTENT, NOT THE ATTEMPT. One click = one key, reused by every network
 * attempt that click causes — the session layer's 401 refresh-and-replay above all. A key
 * generated per attempt makes the replay look like a second, unrelated request to the server,
 * which is precisely the double-charge the header exists to prevent. `useApiMutation` gets this
 * right by capturing the key in the closure it hands to `withAuth`.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
