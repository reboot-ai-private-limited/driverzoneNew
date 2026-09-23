import type { Role } from '@driverzone/contracts';

/**
 * PORT — reading and creating the account behind a phone number.
 *
 * One port across all three roles rather than three, because every operation the auth flow needs
 * is "the account for this number, in this role". The three collections differ enormously in
 * what else they hold — a driver has documents and a duty state, an admin has neither — but none
 * of that is auth's business, and a port shaped around the full documents would drag the whole
 * profile surface into a module boundary that only needs an id and a name.
 */

/** The slice of an account the auth flow actually uses. */
export interface Account {
  id: string;
  mobileNumber: string;
  /** Null until filled in — customer and driver profiles complete progressively. */
  fullName: string | null;
  /** Whether the account is suspended/deactivated. */
  isBlocked: boolean;
}

export interface AccountRepositoryPort {
  findByPhone(role: Role, phone: string): Promise<Account | undefined>;

  /**
   * The same slice, by id. `undefined` for an account that no longer exists as far as signing in
   * is concerned — never created, deleted, or (for an admin) deactivated — which is what refresh
   * asks before minting a new access token.
   */
  findById(role: Role, id: string): Promise<Account | undefined>;

  /**
   * Creates a bare account holding nothing but the number.
   *
   * **Never called for `ADMIN`** — admin accounts are provisioned out of band, and the use case
   * enforces that rather than this port refusing it. Keeping the refusal in the use case means
   * the rule is visible where the decision is made, next to the comment explaining why.
   */
  create(role: Role, phone: string): Promise<Account>;
}
