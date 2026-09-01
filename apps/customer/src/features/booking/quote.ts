import { useEffect, useState } from 'react';
import type { CreateQuoteResponse, QuoteOptionDto, UnavailableReason } from '@driverzone/contracts';

/**
 * Presentation rules for a fare card. No arithmetic — every rupee on this screen is a string the
 * server rendered (`Money.amount_display`), and this file must never grow a function that adds
 * two of them up.
 *
 * CONTRAST THIS WITH `coverage.ts`, which writes its own copy because `/coverage/check` sends
 * none. `POST /quotes` DOES send a customer-safe `message` on every unavailable answer, so that
 * message is rendered verbatim here and this file supplies only the framing a message cannot
 * carry: an icon, a tone, and which action gets the customer out of the dead end. A new reason
 * added server-side therefore renders correctly on a build that predates it — which is the whole
 * rule in docs/LLD/api-contracts.md, and matters most on a store binary nobody can recall.
 */

/**
 * Reason → the one short line above the server's message.
 *
 * NO ACTION IS OFFERED WITH THESE, deliberately. An unavailable answer means there is no fare to
 * confirm, so the screen shows the reason and nothing to press — the header's back arrow is the
 * way out, and it goes to the map where both pins live. A button repeating what back already does
 * is a second control for one action, and the screen has no fare card to sit beside it anyway.
 *
 * The `default` branch is load-bearing, not defensive padding: `UNAVAILABLE_REASONS` will grow,
 * and an older build must degrade to "the server's message under a generic line" rather than
 * render an empty notice.
 */
export function unavailableTitle(reason: UnavailableReason | string): string {
  switch (reason) {
    case 'ZONE_NO_PICKUP_COVERAGE':
      return 'No drivers at this pickup point';
    case 'PICKUP_OUTSIDE_CITY':
      return 'We cannot start a trip here';
    case 'DROP_OUTSIDE_CITY':
      return 'That destination is out of town';
    case 'NO_PACKAGE_FOR_DISTANCE':
      return 'No package covers this distance';
    case 'NO_PACKAGE_AVAILABLE':
      return 'Nothing to offer for this trip';
    case 'ROUTE_NOT_FOUND':
      return 'We could not find a route';
    default:
      return 'We cannot price this trip';
  }
}

/**
 * The sub-line under an option's headline.
 *
 * `label` is already display-ready ('3 Hours', 'PKG-3 — One way'), so this exists only to say
 * what the customer is BUYING — and only incity has an answer. Outstation returns
 * `included_minutes: null` because a package is a package however long it takes, and inventing
 * "unlimited" or "0 minutes" there would both be lies.
 *
 * Since 2026-08-28 there is NO OVERAGE: the quoted total is the total, and a 3-hour rental that
 * runs 3h 40m costs what the customer was told. So this says "included" and stops — an "extra
 * charges apply after" line would describe a mechanism that no longer exists.
 */
export function includedCopy(option: QuoteOptionDto): string | null {
  const minutes = option.included_minutes;
  if (minutes === null) return null;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${String(rest)} minutes included`;
  if (rest === 0) return `${String(hours)} ${hours === 1 ? 'hour' : 'hours'} included`;
  return `${String(hours)}h ${String(rest)}m included`;
}

/**
 * Whether this option needs the driver-expenses acknowledgment before it can be confirmed.
 *
 * EVERY OPTION NEEDS IT EXCEPT THE INCITY 3-HOUR PACKAGE. That single carve-out is a product
 * decision, not something the server states — `QuoteOptionDto` carries no flag for it, because
 * nothing in the fare or the booking lifecycle depends on it. So this reads the shape of the
 * option instead: `service_type === 'INCITY' && included_minutes === 180`. That is a real
 * assumption about how the shortest incity duration is configured today, not a contract
 * guarantee, and it is the one to grep for if a package ever gets renamed or re-timed to
 * something other than 180 minutes.
 *
 * DEFAULTS TO REQUIRED. An option this rule cannot positively clear as "the 3-hour package" is
 * treated as needing the acknowledgment — a longer incity rental, a same-day outstation trip, an
 * overnight one, all can put the driver somewhere they need to eat or stay on their own money,
 * and the safer failure here is one unnecessary tap, not a customer who was never told.
 */
export function needsDriverExpenseAgreement(option: QuoteOptionDto): boolean {
  return !(option.service_type === 'INCITY' && option.included_minutes === 180);
}

/**
 * The one-line trip fact under the header: how far, over what ground.
 *
 * Outstation only — `distance_km` and `terrain` are null for incity, because an incity fare is
 * bought by the hour and the road distance did not decide the price. Showing a distance that had
 * no bearing on the fare invites the question "then why am I paying this?".
 */
export function tripFacts(response: CreateQuoteResponse): string | null {
  if (response.service_type !== 'OUTSTATION') return null;

  const parts: string[] = [];
  if (response.distance_km !== null) parts.push(`${response.distance_km.toFixed(0)} km one way`);
  if (response.terrain === 'HILL') parts.push('hill route');
  if (response.outstation_hours_per_day !== null) {
    parts.push(`${String(response.outstation_hours_per_day)} hours of driving per day`);
  }

  return parts.length === 0 ? null : parts.join(' · ');
}

export interface Countdown {
  /** Whole seconds remaining. Floored at zero — never negative. */
  secondsLeft: number;
  expired: boolean;
  /** `4:31`, or `0:00` once expired. */
  display: string;
}

/**
 * Counts a fare card down to its `expires_at`.
 *
 * EVERY OPTION IN ONE RESPONSE EXPIRES TOGETHER — the server creates them in one batch with one
 * TTL and says so on the DTO — which is what makes a single countdown honest rather than an
 * approximation of several.
 *
 * The interval is cleared and re-established whenever `expiresAt` changes, so a re-quote restarts
 * the clock instead of leaving a stale timer writing over the new one. It also stops ticking once
 * expired: an interval that runs forever on a screen the customer has walked away from is a
 * wakelock nobody asked for.
 */
export function useQuoteCountdown(expiresAt: string | null): Countdown {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (expiresAt === null) return;

    // Reset on every new fare card, before the first tick — otherwise the first second of a
    // fresh quote is measured against the previous one's clock.
    setNow(Date.now());

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [expiresAt]);

  if (expiresAt === null) return { secondsLeft: 0, expired: false, display: '0:00' };

  const remainingMs = Date.parse(expiresAt) - now;
  /*
   * `Number.isNaN` guards an unparseable date. It should not happen — the server sends ISO 8601 —
   * but the alternative to guarding is a NaN countdown that reads as expired and traps the
   * customer in a re-quote loop they cannot escape.
   */
  const secondsLeft = Number.isNaN(remainingMs) ? 0 : Math.max(0, Math.floor(remainingMs / 1000));

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return {
    secondsLeft,
    expired: secondsLeft === 0,
    display: `${String(minutes)}:${String(seconds).padStart(2, '0')}`,
  };
}
