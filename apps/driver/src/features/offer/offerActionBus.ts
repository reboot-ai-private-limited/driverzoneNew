/**
 * Hands an Accept / Decline pressed on the RINGING NOTIFICATION to the ring screen, when one is
 * already open for that offer.
 *
 * With the app open, the push posts the notification AND opens the ring screen. A press on the
 * notification then has to act through that screen — so it shows "Trip is yours" / closes itself
 * exactly as if the driver had tapped the on-screen button — rather than open a second screen
 * (which `openOffer` refuses anyway) or answer behind the screen's back and leave it ringing.
 */
export type OfferAction = 'accept' | 'decline';

type Listener = (offerId: string, action: OfferAction) => boolean;

const listeners = new Set<Listener>();

/** Returns true when an open ring screen took the action; false means nobody is listening. */
export function dispatchOfferAction(offerId: string, action: OfferAction): boolean {
  let handled = false;
  for (const listener of listeners) {
    if (listener(offerId, action)) handled = true;
  }
  return handled;
}

/** For the ring screen. The listener returns true only for its own offer. */
export function onOfferAction(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
