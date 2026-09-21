import type {
  AcceptScheduledBookingResponse,
  ListScheduledBoardResponse,
} from '@driverzone/contracts';
import { ROLE_PREFIX } from '../../config';
import { getAccessToken } from '../../auth/session';
import { request } from '../client';

/**
 * `/driver/scheduled-bookings/*` — the board of trips nobody took.
 *
 * NOT OFFERS, and kept in its own file to stop the two blurring. An offer rings, expires in
 * forty-five seconds and is scored against the driver's acceptance rate. These are trips the
 * early search found nobody for, parked until somebody takes them or the final ring at T−90 —
 * browsed in the driver's own time, with no clock and no penalty for scrolling past.
 *
 * See docs/LLD/dispatch-and-assignment.md §Ring early, park, ring again.
 */

/**
 * Every parked trip this driver could actually take.
 *
 * The server does the filtering — vehicle competency and clashes with trips they already hold —
 * so the app never shows a row that would be refused on tap.
 */
export function listScheduledBoard(signal?: AbortSignal): Promise<ListScheduledBoardResponse> {
  return request<ListScheduledBoardResponse>(`${ROLE_PREFIX}/scheduled-bookings`, {
    token: getAccessToken() ?? undefined,
    signal,
  });
}

/**
 * Take one.
 *
 * `claimed: false` IS A 200, like accepting a ringing offer. Two drivers can be looking at this
 * list at the same moment, and over a window measured in days rather than seconds that will
 * happen — so the caller branches on `claimed` and shows `message`, never catches.
 */
export function acceptScheduledBooking(
  bookingId: string,
): Promise<AcceptScheduledBookingResponse> {
  return request<AcceptScheduledBookingResponse>(
    `${ROLE_PREFIX}/scheduled-bookings/${bookingId}/accept`,
    {
      method: 'POST',
      token: getAccessToken() ?? undefined,
    },
  );
}
