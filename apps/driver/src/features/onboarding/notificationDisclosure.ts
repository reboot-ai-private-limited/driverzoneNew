import * as SecureStore from 'expo-secure-store';
import { PermissionsAndroid, Platform } from 'react-native';

/**
 * The explanation shown before Android's "Allow notifications?" prompt.
 *
 * NOT a Play policy requirement, unlike [[backgroundLocationDisclosure]] — notifications need no
 * prominent disclosure. It exists because the prompt matters more to a driver than to almost any
 * app user: refuse it and trip offers arrive with nothing on screen, and a driver who does not know
 * that just stops getting work. Android's own dialog says none of that, so this screen does, once,
 * before it appears.
 *
 * Same storage and namespacing as the location disclosure, for the same reasons.
 */
const DECISION_KEY = 'dz.driver.notification_disclosure';

type Decision = 'accepted' | 'declined';

async function readDecision(): Promise<Decision | null> {
  try {
    const raw = await SecureStore.getItemAsync(DECISION_KEY);
    return raw === 'accepted' || raw === 'declined' ? raw : null;
  } catch {
    // Unreadable: show the explanation again. Being told twice costs nothing here.
    return null;
  }
}

async function writeDecision(decision: Decision): Promise<void> {
  try {
    await SecureStore.setItemAsync(DECISION_KEY, decision);
  } catch {
    // Worst case the driver sees the explanation once more on the next duty toggle.
  }
}

export const markNotificationsAccepted = (): Promise<void> => writeDecision('accepted');
export const markNotificationsDeclined = (): Promise<void> => writeDecision('declined');

/**
 * Should going on duty show the explanation before asking?
 *
 * Only on Android 13+ (API 33), the first version where notifications are a runtime permission —
 * below it they are simply on and there is no prompt to explain. Not once a decision is on record,
 * and not when the permission is already granted, which covers every driver who allowed it under an
 * earlier build.
 */
export async function needsNotificationDisclosure(): Promise<boolean> {
  if (Platform.OS !== 'android' || Platform.Version < 33) return false;
  if ((await readDecision()) !== null) return false;

  try {
    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    return !granted;
  } catch {
    return false;
  }
}
