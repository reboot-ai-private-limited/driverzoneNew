import { Easing } from 'react-native-reanimated';

/**
 * The app's motion, in one place — durations and the one easing curve every transition shares.
 *
 * WHY TOKENS. The booking flow is a stack of pieces that animate TOGETHER: the sheet resizes, its
 * contents crossfade, the top bar swaps, the map padding glides with the sheet, and the camera waits
 * for that glide. Each used to carry its own copy of "280" or "180", and the day one changed alone
 * the pieces would visibly fall out of step. Named here, a change moves all of them.
 *
 * The values are the ones measured smooth on the test device; see the call sites for why each
 * piece uses the one it does.
 */
export const motion = {
  /** Something leaving. Short, so it is gone before what replaces it is noticed. */
  exit: 120,
  /** Something arriving — a notice, a list, a row of chips. */
  enter: 180,
  /** A layout change: siblings sliding to make room. */
  layout: 200,
  /** A larger arrival — the search bar, a card rising into place. */
  emphasis: 220,
  /** The bottom sheet easing to a new height. The map's padding and camera hold follow this. */
  sheet: 280,
  /** How long an incoming element waits for the outgoing one to clear the same spot. */
  handoff: 90,
  /** Between successive rows of a list that rises in. */
  stagger: 40,
} as const;

/** Ease-out with a soft start: quick to respond, settling gently, never overshooting. */
export const MOTION_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);
