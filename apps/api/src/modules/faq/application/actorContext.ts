/**
 * The admin performing a write, and where from. Same shape as
 * `settings/application/actorContext.ts`; each module declares its own rather than importing
 * across a module boundary (`module-internals-are-private`).
 */
export interface ActorContext {
  adminId: string;
  ip?: string | undefined;
}
