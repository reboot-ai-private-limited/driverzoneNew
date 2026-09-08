import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';
import { pushLog } from './log';

/**
 * THE FULL-SCREEN-INTENT PERMISSION — the one Android 14+ withholds by default, and the reason a
 * trip offer shows on this device without waking the screen.
 *
 * From API 34, `USE_FULL_SCREEN_INTENT` is auto-granted only to apps whose Play listing is a
 * phone dialer or an alarm clock. Everything else starts at DENY, and a `fullScreenAction`
 * notification silently degrades — or, with Notifee 9.x, its `displayNotification` call is
 * rejected outright (see the ladder in `offerNotification.ts`). Confirmed on the test handset:
 * `adb shell cmd appops get in.driverzone.driver USE_FULL_SCREEN_INTENT` → `deny`.
 *
 * There is NO runtime prompt for it. The only route is a dedicated system settings page,
 * `Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`, added in API 34. This opens it, scoped to
 * this app, so the driver lands on a single toggle rather than hunting through notification
 * settings.
 *
 * Best-effort: on API < 34 the action does not exist (and the permission is granted anyway), and
 * some OEM skins move or rename the screen. Any failure falls back to the app's own details page,
 * which every Android has and which reaches the same toggle in two more taps.
 */

/** `package:in.driverzone.driver`. */
function packageData(): string {
  const pkg = Constants.expoConfig?.android?.package ?? 'in.driverzone.driver';
  return `package:${pkg}`;
}

/**
 * Open the "Allow full-screen notifications" settings screen for this app.
 *
 * Returns nothing useful — Android gives no callback when the driver flips the toggle, and there
 * is no reliable in-app read of the resulting state without a native module. The duty screen
 * re-checks nothing; it just offers the shortcut and trusts the driver.
 */
export async function openFullScreenIntentSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;

  // Below Android 14 the permission is held automatically — nothing to send the driver to.
  if (typeof Platform.Version === 'number' && Platform.Version < 34) {
    pushLog('FSI settings: not needed below API 34', { api: Platform.Version });
    return;
  }

  try {
    await IntentLauncher.startActivityAsync(
      // The literal action string rather than an `IntentLauncher.ActivityAction` member, which
      // this SDK version does not enumerate yet.
      'android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT',
      { data: packageData() },
    );
    pushLog('FSI settings: opened dedicated screen');
    return;
  } catch (cause) {
    pushLog('FSI settings: dedicated screen unavailable, falling back', { error: String(cause) });
  }

  try {
    await IntentLauncher.startActivityAsync('android.settings.APPLICATION_DETAILS_SETTINGS', {
      data: packageData(),
    });
  } catch {
    await Linking.openSettings();
  }
}
