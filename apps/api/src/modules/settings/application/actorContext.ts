/**
 * The admin performing a write, and where from — threaded into both write use cases. Same shape
 * as `zones/application/actorContext.ts`; each module declares its own rather than importing
 * across a module boundary (`module-internals-are-private`).
 */
export interface ActorContext {
  adminId: string;
  ip?: string | undefined;
}
