import { z } from 'zod';

/**
 * A `YYYY-MM-DD` day filter, read in the timezone the business runs in.
 *
 * IST, NOT UTC. `new Date('2026-09-04')` is midnight UTC, which is 05:30 on the 4th in India —
 * so a filter for "the 4th" built on that would silently drop every row from before breakfast
 * and gain the small hours of the 5th. The offset is applied explicitly so the boundary falls
 * where the person reading the screen thinks it does.
 *
 * SHARED because there were about to be three copies. `ledger.controller.ts` had one,
 * `bookings.controller.ts` grew its own, and the finance feed needs a third. Hand-rolled
 * timezone arithmetic that exists in several places is arithmetic that will eventually disagree
 * with itself, and the failure mode — a report that is off by a few hours at the edges — is one
 * nobody notices until they are reconciling money.
 *
 * `shared/` is below every module (`shared-is-below-modules` in `.dependency-cruiser.cjs`), so
 * any interface layer may import this.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The instant an IST calendar day begins, as UTC. */
export function istDayStart(isoDate: string): Date {
  return new Date(new Date(`${isoDate}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
}

/**
 * The instant the NEXT IST day begins — how an INCLUSIVE `to` day becomes an EXCLUSIVE bound.
 *
 * "To the 18th" has to include a row written at 23:50 on the 18th. Comparing `<=` against the
 * start of the 18th would keep only its first instant, which is the kind of off-by-a-day that
 * looks like missing data rather than a bug.
 */
export function istNextDayStart(isoDate: string): Date {
  return new Date(istDayStart(isoDate).getTime() + 24 * 60 * 60 * 1000);
}

/**
 * A calendar day as a client sends it, validated as a REAL date.
 *
 * Round-tripped rather than merely parsed: `Date.parse('2025-02-30')` does not fail — JavaScript
 * rolls the surplus day over and hands back 2 March — so a "is this parseable" check accepts a
 * date that does not exist and then filters by a different day than the one asked for. That is
 * worse than a 400, because the caller gets rows and no reason to doubt them.
 */
export const isoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine(
    (value) => new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value),
    'Not a real date',
  );
