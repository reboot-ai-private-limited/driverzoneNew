const PAISE = 100;

/**
 * Indian digit grouping — 1234567 paise → "₹12,34,567".
 *
 * A LAST RESORT, not the normal path. Every figure the API sends carries its own `amount_display`
 * formatted exactly this way, and rendering that string is always preferable: it keeps four
 * clients agreeing with the server about what a number looks like. This exists for the two places
 * that have to add figures together before showing them — a ride total that includes adjustments,
 * and a fare with wallet credit taken off — where there is no single server-formatted string to
 * render because the sum did not exist on the server.
 *
 * Lives in `lib` rather than beside either caller: it was in `features/rides` while rides was its
 * only consumer, and the moment the fare sheet needed it too, that import read as the booking flow
 * depending on ride history.
 */
export function formatPaise(paise: number): string {
  const rupees = Math.round(paise / PAISE);
  const sign = rupees < 0 ? '-' : '';
  const digits = String(Math.abs(rupees));

  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped =
    rest.length > 0 ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;

  return `${sign}₹${grouped}`;
}
