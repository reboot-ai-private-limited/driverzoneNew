import { v7 as uuidv7 } from 'uuid';

/**
 * ID generation.
 *
 * The repo convention (docs/README.md): **UUID v7 where ordering matters, v4 otherwise.** v7
 * encodes a millisecond timestamp in its leading bits, so v7 IDs sort chronologically as
 * strings — which is why they are worth the dependency. Node's `crypto.randomUUID` is v4 only.
 */

/**
 * A request correlation ID, in the form specified by docs/LLD/08-api-contracts.md: `req_01J…`.
 *
 * Ordering matters here more than anywhere: these are the keys log lines are grouped by, and a
 * sortable ID means a log viewer with no clock skew problem puts a request's lines in the order
 * they happened. The `req_` prefix makes the ID self-describing when it turns up pasted into a
 * support ticket with no context.
 */
export function newRequestId(): string {
  return `req_${uuidv7()}`;
}
