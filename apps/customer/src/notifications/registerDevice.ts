import notifee from '@notifee/react-native';
import { getMessaging, getToken, onTokenRefresh } from '@react-native-firebase/messaging';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  registerDevice as registerDeviceApi,
  removeDevice as removeDeviceApi,
} from '@/lib/api/endpoints/customer';
import { pushLog } from './log';

/**
 * Telling the server where to send this customer's ride updates.
 *
 * Called once after sign-in and on every FCM token rotation. `POST /customer/devices` is
 * idempotent, so a repeat call with an unchanged token is free — and is the only way to be
 * certain a rotation FCM performed on its own schedule is never missed.
 *
 * A HARD RATE LIMIT guards it: several places may call `registerForPush` (login, an auth resume,
 * a screen effect), and one loose re-entry condition would turn that into a `getToken` +
 * `POST /customer/devices` every second — a bug the driver app hit. One real registration per
 * window is all that is ever needed; rotations still come through `onTokenRefresh`.
 */
const REGISTER_MIN_INTERVAL_MS = 5 * 60 * 1000;
let lastRegisterAt = 0;
let lastRegisterResult = false;
let lastToken: string | null = null;
let unsubscribeFromRefresh: (() => void) | null = null;

/**
 * Ask for notification permission and register the token. Returns whether the customer can be
 * reached — a refusal is not fatal (in-app screens still update live), just quieter.
 *
 * `force` bypasses the rate limit; the sign-in flow passes it so a fresh session registers
 * without waiting out a window from the previous one.
 */
export async function registerForPush(force = false): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  if (!force && Date.now() - lastRegisterAt < REGISTER_MIN_INTERVAL_MS) {
    return lastRegisterResult;
  }

  // Cross-platform: on iOS this shows the system alert AND registers with APNs (Notifee calls
  // `registerForRemoteNotifications` under the hood); on Android 13+ it is the POST_NOTIFICATIONS
  // prompt. `authorizationStatus === 0` is Notifee's DENIED.
  const settings = await notifee.requestPermission();
  if (settings.authorizationStatus === 0) {
    pushLog('registerForPush: notification permission denied');
    lastRegisterAt = Date.now();
    lastRegisterResult = false;
    return false;
  }

  try {
    const token = await getToken(getMessaging());
    lastToken = token;
    pushLog('registerForPush: got FCM token', { fp: `${token.slice(0, 12)}…`, platform: Platform.OS });
    await sendToken(token);
    pushLog('registerForPush: token sent to server ok');
  } catch (cause) {
    // On iOS this is usually "APNs token not set yet" on a cold first launch — transient. The
    // rate-limit window is short (`force` from sign-in aside) and the next authenticated resume
    // retries, so it self-heals without a bespoke retry loop.
    pushLog('registerForPush: FAILED', { error: String(cause) });
    lastRegisterAt = Date.now();
    lastRegisterResult = false;
    return false;
  }

  // Subscribe to rotations ONCE per process — re-subscribing on every call is churn, and on some
  // RNFB builds the act of subscribing fires the listener with the current token, a needless POST.
  if (unsubscribeFromRefresh === null) {
    unsubscribeFromRefresh = onTokenRefresh(getMessaging(), (next: string) => {
      lastToken = next;
      pushLog('onTokenRefresh: rotation, re-sending', { fp: `${next.slice(0, 12)}…` });
      void sendToken(next);
    });
  }

  lastRegisterAt = Date.now();
  lastRegisterResult = true;
  return true;
}

async function sendToken(fcmToken: string): Promise<void> {
  const appVersion = Constants.expoConfig?.version;
  await registerDeviceApi({
    fcm_token: fcmToken,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    ...(appVersion === undefined ? {} : { app_version: appVersion }),
  });
}

/**
 * Sign-out. Withdraws THIS handset server-side (unlike the driver app, which keeps the token
 * across shifts) and stops listening for rotations — a customer who signs out on a shared phone
 * should stop getting another account's ride updates.
 */
export async function stopPushRegistration(): Promise<void> {
  unsubscribeFromRefresh?.();
  unsubscribeFromRefresh = null;
  lastRegisterAt = 0;
  lastRegisterResult = false;

  // `lastToken` is module state and is gone after a relaunch, so fall back to asking FCM — a
  // sign-out on a fresh launch must still be able to withdraw the handset.
  let token = lastToken;
  lastToken = null;
  if (token === null && Platform.OS !== 'web') {
    token = await getToken(getMessaging()).catch(() => null);
  }
  if (token !== null) {
    await removeDeviceApi(token).catch((cause: unknown) => {
      // Best effort — sign-out must not fail because the network did. A stale token is pruned
      // server-side the first time a send to it comes back `not-registered`.
      pushLog('stopPushRegistration: removeDevice failed', { error: String(cause) });
    });
  }
}
