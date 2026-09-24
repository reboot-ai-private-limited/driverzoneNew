/**
 * PORT — the WhatsApp messages an account receives at milestones: a customer's first sign-in and
 * a driver's approval.
 *
 * **NEVER REJECTS.** These are courtesy messages riding on actions that must not fail because of
 * them — a gateway outage must not turn a sign-in into a 500, or make an admin's approval look
 * like it did not happen. Adapters swallow and log their own failures.
 *
 * `name` is null when the account has not filled one in yet, which is always the case for a
 * customer at the moment they are created.
 */
export interface AccountMessagesPort {
  welcomeCustomer(phone: string, name: string | null): Promise<void>;
  driverApproved(phone: string, name: string | null): Promise<void>;
}
