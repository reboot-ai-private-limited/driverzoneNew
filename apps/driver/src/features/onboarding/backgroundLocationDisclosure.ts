import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * THE PROMINENT DISCLOSURE for background location — a Play policy requirement, not a nicety.
 *
 * Google's Location Permissions policy requires that an app requesting `ACCESS_BACKGROUND_LOCATION`
 * show an in-app disclosure BEFORE the runtime prompt appears, and that the disclosure:
 *
 *   - names the data (location), says it is collected in the BACKGROUND, and says what feature
 *     needs it;
 *   - lives in the app itself rather than only in the privacy policy;
 *   - carries an explicit accept and an explicit decline, both of which do what they say. A
 *     screen that can only be dismissed, or that auto-continues, fails review.
 *
 * Reviewers check this by installing the build and going through the flow, so it is not something
 * that can be satisfied by the Console declaration alone — the declaration and the demo video
 * both have to show THIS screen.
 *
 * **What this module is, concretely: the gate that guarantees the OS prompt cannot appear before
 * the disclosure has been accepted.** `dutyForegroundService.ts` used to call
 * `requestBackgroundPermissionsAsync()` unconditionally on the way into a shift, which is the
 * exact violation. It now asks `hasAcceptedBackgroundLocation()` first, and the only code that
 * can answer `true` is the disclosure screen's Allow button.
 *
 * Stored in SecureStore and namespaced `dz.driver.*` for the same reason as the battery flags in
 * [[batteryOptimisation]] — not because a disclosure decision is a secret, but because pulling in
 * a second storage library for one bit is not worth it and a keystore dump should never be
 * ambiguous about whose value it is.
 */
const DECISION_KEY = 'dz.driver.bg_location_disclosure';

type Decision = 'accepted' | 'declined';

async function readDecision(): Promise<Decision | null> {
  try {
    const raw = await SecureStore.getItemAsync(DECISION_KEY);
    return raw === 'accepted' || raw === 'declined' ? raw : null;
  } catch {
    /*
     * A broken keystore must fail CLOSED here, unlike the battery flags which fail open.
     *
     * The difference matters: an unreadable battery flag costs the driver one extra nudge, but an
     * unreadable disclosure flag read as "accepted" would let the OS prompt fire with no
     * disclosure shown — the policy violation this module exists to prevent. `null` means "no
     * decision on record", so the disclosure is shown again. Being asked twice is the acceptable
     * failure; asking without disclosing is not.
     */
    return null;
  }
}

async function writeDecision(decision: Decision): Promise<void> {
  try {
    await SecureStore.setItemAsync(DECISION_KEY, decision);
  } catch {
    // Worst case the driver is asked again next launch, which is exactly what fail-closed means.
  }
}

/** The disclosure was shown and the driver pressed Allow. The ONLY thing that unlocks the prompt. */
export const markBackgroundLocationAccepted = (): Promise<void> => writeDecision('accepted');

/**
 * The disclosure was shown and the driver pressed Not now.
 *
 * Recorded so the screen is not shown again on the next duty toggle. It is deliberately NOT
 * permanent in effect — `needsBackgroundLocationDisclosure` re-offers it if the driver later
 * grants background location from system settings and then revokes it, which is the only way a
 * declined driver can end up wanting this again.
 */
export const markBackgroundLocationDeclined = (): Promise<void> => writeDecision('declined');

export async function hasAcceptedBackgroundLocation(): Promise<boolean> {
  return (await readDecision()) === 'accepted';
}

/**
 * Should the duty flow route to the disclosure screen before starting a shift?
 *
 * Four conditions, and every one of them is a reason NOT to show it:
 *
 *   - not Android — iOS has no separate background-location grant of this shape;
 *   - a decision is already on record — asked once is enough, either way;
 *   - the permission is already granted — nothing left to disclose or ask for. This is the case
 *     that matters for drivers already in the field when this ships: they granted it under the
 *     old build, so they are never shown a screen asking for something they have already given;
 *   - `canAskAgain` is false — Android will not show a prompt no matter what we do, so a
 *     disclosure would be a dead end rather than a choice.
 *
 * Fails to `false` on an unreadable permission state. That looks like it contradicts the
 * fail-closed rule above, but it does not: this function gates whether to SHOW the screen, while
 * `hasAcceptedBackgroundLocation` gates whether to PROMPT. Skipping the screen leaves the prompt
 * still locked; there is no path from here to an undisclosed prompt.
 */
export async function needsBackgroundLocationDisclosure(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if ((await readDecision()) !== null) return false;

  try {
    const permission = await Location.getBackgroundPermissionsAsync();
    return !permission.granted && permission.canAskAgain;
  } catch {
    return false;
  }
}
