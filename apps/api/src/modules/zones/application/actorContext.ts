/**
 * The admin performing a write, and where from — threaded into every use case below that
 * writes an audit entry. Centralised here (unlike `identity/application/useCases/verifyDriver
 * .usecase.ts`, which declares its own copy) because five use cases in this module need it,
 * not one.
 */
export interface ActorContext {
  adminId: string;
  ip?: string | undefined;
}
