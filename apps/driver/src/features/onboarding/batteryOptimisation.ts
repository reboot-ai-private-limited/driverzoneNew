import notifee from '@notifee/react-native';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Two one-bit local memories about the battery-optimisation screen. Neither is security
 * sensitive, but they ride in SecureStore rather than pulling in a second storage library for
 * two flags, and are namespaced `dz.driver.*` like the refresh token so a keystore dump is never
 * ambiguous about whose value it is.
 *
 * The two are deliberately separate because they answer different questions:
 *
 *   `seen`      — has the driver been TAKEN to this screen at least once? Gates the one-time
 *                 forced redirect out of `/gate`. Set the moment the screen decides not to
 *                 nag any harder, whichever button the driver pressed.
 *   `confirmed` — has the driver said they actually did it? Gates the Home banner, which keeps
 *                 nudging until they do. "Remind me later" sets `seen` but not `confirmed`, so
 *                 the forced redirect stops while the banner stays.
 *
 * Neither is a claim that battery optimisation is genuinely off. They only record what the driver
 * was shown and what they said. For whether it is ACTUALLY off, see `isBatteryOptimisationActive`
 * at the bottom of this file — that one asks Android, and it is what the Home banner reads.
 */
const SEEN_KEY = 'dz.driver.battery_setup_seen';
const CONFIRMED_KEY = 'dz.driver.battery_setup_confirmed';

async function read(key: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(key)) === '1';
  } catch {
    // A broken keystore must not wedge the boot flow. Falling back to "no" just means the driver
    // sees the screen or banner again, which is harmless.
    return false;
  }
}

async function write(key: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, '1');
  } catch {
    // Worst case: the nudge shows once more next launch.
  }
}

export const hasSeenBatterySetup = (): Promise<boolean> => read(SEEN_KEY);
export const markBatterySetupSeen = (): Promise<void> => write(SEEN_KEY);

export const hasConfirmedBatterySetup = (): Promise<boolean> => read(CONFIRMED_KEY);

/** Confirming implies seen — set both, so a confirm from a re-visit still clears the redirect. */
export async function markBatterySetupConfirmed(): Promise<void> {
  await write(SEEN_KEY);
  await write(CONFIRMED_KEY);
}

/**
 * IS ANDROID STILL BATTERY-OPTIMISING US? The one question above that is answered by the OS
 * rather than by the driver.
 *
 * `true` means optimisation is ACTIVE — the bad state, where the app can be frozen in the
 * background and its offers delayed or dropped.
 *
 * The header above says the OS "gives no reliable read of that from inside the app". That was
 * written before this: Notifee exposes `PowerManager.isIgnoringBatteryOptimizations`, which is
 * exactly that read, and it is the standard AOSP check honoured by Nothing, Samsung, Lava and
 * every other skin. It does NOT see an OEM autostart list — a Xiaomi phone can report itself
 * unoptimised while MIUI still refuses to let the app start — so it is a floor, not a guarantee.
 *
 * Why it matters that this exists: `confirmed` records only that a driver TAPPED "I've set this
 * up". A driver who taps it without changing anything, or who has the setting reset by a system
 * update, silences the banner for ever and then quietly stops receiving work with nothing on
 * screen to explain it. This read catches both.
 *
 * Fails to `false` — "not optimised", i.e. do not nag. An unreadable power manager must not
 * produce a warning banner the driver cannot act on or dismiss.
 */
export async function isBatteryOptimisationActive(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await notifee.isBatteryOptimizationEnabled();
  } catch {
    return false;
  }
}

/**
 * Should the Home banner nag?
 *
 * The OS reading WINS over the driver's confirmation, in both directions:
 *
 *   - still optimised → nag, even if they once tapped "I've set this up". This is the case that
 *     used to go unnoticed: a system update re-enables optimisation and the app goes quiet.
 *   - not optimised → do not nag, even if they never confirmed. A driver who fixed it from the
 *     system settings rather than through our screen has done the thing we were asking for, and
 *     nagging them for the paperwork is how a real warning gets trained into background noise.
 *
 * The stored `confirmed` flag survives only as the answer for a device whose power manager cannot
 * be read at all.
 */
export async function needsBatterySetup(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    return await notifee.isBatteryOptimizationEnabled();
  } catch {
    // No usable read — fall back to what the driver told us.
    return !(await hasConfirmedBatterySetup());
  }
}
