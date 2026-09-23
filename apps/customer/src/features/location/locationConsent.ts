import * as SecureStore from 'expo-secure-store';

/**
 * Whether the customer has answered the "Use your location for pickup?" explanation.
 *
 * Not a Play requirement — this app only uses location while it is open — but Android's own
 * prompt appears the instant the home screen mounts, before the customer has seen the app at all,
 * and a cold "Allow DriverZone to access this device's location?" is the version people refuse. One
 * sentence first about what it is for is the difference.
 *
 * SecureStore rather than a second storage library, for the same reason the driver app gives:
 * one bit is not worth a dependency.
 */
const DECISION_KEY = 'dz.customer.location_explained';

export type LocationDecision = 'accepted' | 'declined';

export async function readLocationDecision(): Promise<LocationDecision | null> {
  try {
    const raw = await SecureStore.getItemAsync(DECISION_KEY);
    return raw === 'accepted' || raw === 'declined' ? raw : null;
  } catch {
    // Unreadable: explain again. Being asked twice is fine; prompting cold is what this avoids.
    return null;
  }
}

export async function writeLocationDecision(decision: LocationDecision): Promise<void> {
  try {
    await SecureStore.setItemAsync(DECISION_KEY, decision);
  } catch {
    // Worst case the explanation shows once more next launch.
  }
}
