/**
 * What the customer owes for a trip, net: fare plus extras plus waiting, less wallet credit, plus
 * carried-over debt, floored at zero.
 *
 * ONE COPY OF THE ARITHMETIC. `payable.total` on every `BookingDto` and the history's "Total
 * Spent" tile are the same figure, and two copies of it is how a receipt and a summary come to
 * disagree about one trip.
 */
export function netPayablePaise(parts: {
  farePaise: number;
  extrasPaise: number;
  waitingPaise: number;
  walletCreditPaise: number;
  walletDebtPaise: number;
}): number {
  return Math.max(
    0,
    parts.farePaise +
      parts.extrasPaise +
      parts.waitingPaise -
      parts.walletCreditPaise +
      parts.walletDebtPaise,
  );
}
