/**
 * Every debounce and throttle interval in the panel, in one file.
 *
 * Not because three numbers need a module, but because the alternative is `400` appearing as a
 * literal in the zone editor and `450` in whatever is written next — two components that are
 * supposed to feel the same and do not, with nothing in either file to say they were meant to
 * agree.
 */

/** Free-text filters. Below ~200ms a fast typist still fires per keystroke; above ~350ms the input feels laggy. */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * The bookings search box specifically — requested at 300ms rather than the panel's usual
 * `SEARCH_DEBOUNCE_MS`. Kept as its own constant rather than raising the shared one: every other
 * free-text filter (customers, drivers) was left at 250ms, and folding this into the shared
 * value would have quietly changed their feel too for a request that named only bookings.
 */
export const BOOKING_SEARCH_DEBOUNCE_MS = 300;

/** Live geometry validation. Fixed by docs/LLD/admin-panel.md §Live validation — do not re-guess it here. */
export const VALIDATE_DEBOUNCE_MS = 400;

/**
 * Continuous pointer gestures — map pan, drag, resize. A throttle, not a debounce: the handler
 * must run DURING the gesture, just not once per frame. A debounce would run it only after the
 * user stopped, which for a map means nothing updates while it is moving.
 */
export const MAP_THROTTLE_MS = 100;

/**
 * The assignable-driver picker in the transfer/assign dialog.
 *
 * LONGER THAN `SEARCH_DEBOUNCE_MS` ON PURPOSE. 250ms collapses the keystrokes within a word but
 * not the pause between two — an admin typing "Ramesh Kumar" naturally rests 300–600ms at the
 * space, which is past the threshold, so the word boundary fired a request of its own. Every one
 * of those is a name-regex scan the admin never asked for, and unlike a list filter nobody is
 * reading the intermediate result: this list is scrolled once, at the end, to pick one person.
 *
 * Its own constant rather than raising the shared one: the list screens are filters the admin
 * watches narrow as they type, and making those lag would be a real loss for a problem they do
 * not have.
 */
export const DRIVER_PICKER_DEBOUNCE_MS = 500;
