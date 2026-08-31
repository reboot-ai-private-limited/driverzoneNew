import * as SecureStore from 'expo-secure-store';

/**
 * Where the REFRESH token lives between launches — Android Keystore / iOS Keychain, not
 * AsyncStorage and not a plain file.
 *
 * The access token is not stored at all; it lives in a module variable in `session.ts` and dies
 * with the process. That is the same rule as the admin panel, but the refresh token has to be
 * persisted here where it is not on the web: the panel keeps it in an httpOnly cookie the
 * browser holds, and a phone has no equivalent. Android will kill a backgrounded app whenever it
 * wants memory, and a customer re-entering their number every time that happens would not use
 * the app twice.
 */
const REFRESH_TOKEN_KEY = 'dz.customer.refresh_token';

export async function readRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    // A device with a broken or unavailable keystore should land the customer on the login
    // screen, not crash the app on its first frame.
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
