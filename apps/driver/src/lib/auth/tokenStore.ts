import * as SecureStore from 'expo-secure-store';

/**
 * Where the REFRESH token lives between launches — Android Keystore, not AsyncStorage and not a
 * plain file.
 *
 * The access token is not stored at all; it lives in a module variable in `session.ts` and dies
 * with the process. The refresh token has to be persisted, and on this app more than any other:
 * Android will kill a backgrounded app whenever it wants memory, and a driver re-entering their
 * number every time that happens mid-shift would stop using the app.
 *
 * The key is namespaced `dz.driver.*` — deliberately NOT the customer app's `dz.customer.*`. The
 * two apps are separate packages with separate sandboxes so they could not collide anyway, but
 * naming them apart means a log line or a keystore dump is never ambiguous about whose token it
 * is, and the tokens carry different `aud` claims.
 */
const REFRESH_TOKEN_KEY = 'dz.driver.refresh_token';

export async function readRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    // A device with a broken or unavailable keystore should land the driver on the login screen,
    // not crash the app on its first frame.
    return null;
  }
}

export async function writeRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
}

export async function clearRefreshToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    // Deleting something that is not there is not a failure worth propagating.
  }
}

export function isSecureStoreAvailable(): Promise<boolean> {
  return SecureStore.isAvailableAsync();
}
