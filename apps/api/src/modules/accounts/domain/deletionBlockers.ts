import type { AccountDeletionBlocker } from '@driverzone/contracts';

/**
 * DOMAIN — what stops an account closing, as a pure function of facts gathered elsewhere.
 *
 * Every blocker is something that would be LOST or STRANDED by erasing the person: a trip someone
 * is counting on, money one side owes the other. None of them is a reason to keep somebody's data
 * against their wishes for long — each has a way to clear it, and the message says what it is.
 *
 * ALL blockers are returned, not the first. Someone told one reason per attempt fixes it, tries
 * again, and is told the next; that is how a deletion flow feels like it is designed to be given
 * up on.
 */
export interface DeletionFacts {
  role: 'CUSTOMER' | 'DRIVER';
  hasOpenBooking: boolean;
  isOnDuty: boolean;
  /**
   * Customer: the wallet, positive = credit they hold. Driver: the ledger balance, either sign.
   * In paise.
   */
  balancePaise: number;
}

export function deletionBlockers(facts: DeletionFacts): AccountDeletionBlocker[] {
  const blockers: AccountDeletionBlocker[] = [];

  if (facts.hasOpenBooking) {
    blockers.push({
      code: 'OPEN_BOOKING',
      message:
        facts.role === 'CUSTOMER'
          ? 'You have a trip that is not finished yet, or one booked for later. Complete or cancel it first.'
          : 'You have a trip assigned to you that is not finished yet. Complete it, or ask us to reassign it, first.',
    });
  }

  if (facts.role === 'DRIVER' && facts.isOnDuty) {
    blockers.push({ code: 'ON_DUTY', message: 'Go off duty first.' });
  }

  /*
   * A customer's CREDIT does not block: it is theirs to give up, and the confirm screen says it
   * will be lost. Their DEBT does — it is owed to the drivers and to us, and erasing the person it
   * is owed by is not a way to settle it.
   */
  if (facts.role === 'CUSTOMER' && facts.balancePaise < 0) {
    blockers.push({
      code: 'WALLET_DEBT',
      message: 'You have an unpaid balance on your wallet. Pay it on your next trip or contact us to settle it.',
    });
  }

  /*
   * A driver's balance blocks in BOTH directions: positive is earnings we still owe them, which
   * cannot be paid to an account that no longer exists; negative is commission they owe us.
   */
  if (facts.role === 'DRIVER' && facts.balancePaise !== 0) {
    blockers.push({
      code: 'UNSETTLED_BALANCE',
      message:
        facts.balancePaise > 0
          ? 'We still owe you earnings. Contact us to be paid out before closing your account.'
          : 'You have commission to pay. Settle it with us before closing your account.',
    });
  }

  return blockers;
}

/** Credit a customer gives up by closing. Never negative — a debt blocks instead. */
export function forfeitedCreditPaise(facts: DeletionFacts): number {
  return facts.role === 'CUSTOMER' && facts.balancePaise > 0 ? facts.balancePaise : 0;
}
