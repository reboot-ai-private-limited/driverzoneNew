/**
 * `scheduled_at` in the words a driver needs: is this now, or is it later?
 *
 * LIFTED OUT OF `app/offer/[offerId].tsx`, where it started, because the ring screen is no longer
 * the only place a driver is shown a pickup time they have to plan around. An admin can hand out a
 * booking days before its pickup, so the duty screen lists trips already held for later — and a
 * second copy of this function is how the two screens come to disagree about what "Tomorrow"
 * means at 11pm.
 *
 * The one-minute floor on "Now" is deliberate: dispatch rings for immediate trips within seconds
 * of the booking, so a little clock skew either way must still read as "Now" rather than flipping
 * to a wall-clock time that implies waiting.
 *
 * Hand-rolled month/day handling is deliberately NOT used here, unlike the customer app's
 * `formatWhen` — `toLocaleDateString` with an explicit `en-IN` is what this screen has always
 * shipped, and changing the rendering while moving the function would hide a visual change inside
 * a refactor.
 */
export function formatWhen(iso: string): string {
  const when = new Date(iso);
  const minutesAway = (when.getTime() - Date.now()) / 60000;

  if (minutesAway <= 1) return 'Now';
  if (minutesAway < 60) return `In ${Math.round(minutesAway)} min`;

  const time = when.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (when.toDateString() === new Date().toDateString()) return `Today, ${time}`;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (when.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;

  return `${when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
}
