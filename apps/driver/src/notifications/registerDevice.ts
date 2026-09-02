import { getMessaging, getToken, onTokenRefresh } from '@react-native-firebase/messaging';
import Constants from 'expo-constants';
import notifee from '@notifee/react-native';
import { Platform } from 'react-native';
import { registerDevice as registerDeviceApi } from '@/lib/api/endpoints/driver';

/**
 * Telling the server where to ring this handset.
 *
 * Without a registered token every offer to this driver is a `NONE` delivery: dispatch rings
 * nobody and records that it could not. So this runs on going on duty, and again on every token
 * rotation — FCM rotates without asking, and a rotation missed is a driver who silently stops
 * receiving work.
 *
 * `POST /driver/devices` is idempotent (`$addToSet`), so calling it on every launch with an
 * unchanged token is free and is the only way to be certain a rotation is never missed.
 */

let unsubscribeFromRefresh: (() => void) | null = null;

/**
 * Ask for notification permission and register the token.
 *
 * Returns whether the driver can actually be rung. A refusal is worth surfacing: on Android 13+
 * a denied `POST_NOTIFICATIONS` means offers arrive silently with nothing on screen, and a driver
 * would have no way to work out why they stopped getting trips.
 */
export async function registerForPush(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  const settings = await notifee.requestPermission();
  // 0 is DENIED; anything above is granted in some form.
  if (settings.authorizationStatus === 0) return false;

  try {
    const token = await getToken(getMessaging());
    await sendToken(token);
  } catch {
    // A token fetch can fail on a device with no Play Services. Nothing else in the app depends
    // on it, so this stays quiet rather than blocking the driver from going on duty.
    return false;
  }

  // FCM rotates tokens on its own schedule. Without this subscription the server keeps ringing an
  // address that stopped working, and the driver never finds out.
  unsubscribeFromRefresh?.();
  unsubscribeFromRefresh = onTokenRefresh(getMessaging(), (next: string) => {
    void sendToken(next);
  });

  return true;
}

async function sendToken(fcmToken: string): Promise<void> {
  const appVersion = Constants.expoConfig?.version;
  await registerDeviceApi({
    fcm_token: fcmToken,
    platform: 'android',
    ...(appVersion === undefined ? {} : { app_version: appVersion }),
  });
}

/**
 * Stop listening for rotations.
 *
 * Deliberately does NOT delete the token server-side. A driver going off duty for the night still
 * owns this handset, and dispatch already filters on `isOnDuty` — dropping the registration would
 * mean a fresh permission dance every shift for no gain. Sign-out is where a token should be
 * withdrawn.
 */
export function stopPushRegistration(): void {
  unsubscribeFromRefresh?.();
  unsubscribeFromRefresh = null;
}
