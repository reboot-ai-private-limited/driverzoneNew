import * as SecureStore from 'expo-secure-store';

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
 * Neither is a claim that battery optimisation is genuinely off — the OS gives no reliable read
 * of that from inside the app. They only record what the driver was shown and what they said.
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
