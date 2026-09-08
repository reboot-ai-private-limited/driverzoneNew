import { getMessaging, getToken, onTokenRefresh } from '@react-native-firebase/messaging';
import Constants from 'expo-constants';
import notifee from '@notifee/react-native';
import { Platform } from 'react-native';
import { registerDevice as registerDeviceApi } from '@/lib/api/endpoints/driver';
import { pushLog } from './log';

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
 * When the token was last successfully sent, and the last result.
 *
 * A HARD RATE LIMIT. `registerForPush` is called from several places — the duty toggle, the
 * resume listener, the Home effect, the boot restore — and a bug in any of their re-entry
 * conditions used to turn that into a call every second: `getToken()` + a `POST /driver/devices`
 * on a loop. The server write is idempotent (`$addToSet`), so a redundant call is harmless in
 * effect, but the traffic is not free and the loop was a symptom worth refusing to participate
 * in. One real registration per window is all that is ever needed — FCM rotations still come
 * through `onTokenRefresh`, which is not rate limited.
 */
const REGISTER_MIN_INTERVAL_MS = 5 * 60 * 1000;
let lastRegisterAt = 0;
let lastRegisterResult = false;

/**
 * Ask for notification permission and register the token.
 *
 * Returns whether the driver can actually be rung. A refusal is worth surfacing: on Android 13+
 * a denied `POST_NOTIFICATIONS` means offers arrive silently with nothing on screen, and a driver
 * would have no way to work out why they stopped getting trips.
 *
 * Pass `force` to bypass the rate limit — the sign-in flow does, because a brand-new session must
 * register without waiting out a window left over from the previous one.
 */
export async function registerForPush(force = false): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  if (!force && Date.now() - lastRegisterAt < REGISTER_MIN_INTERVAL_MS) {
    return lastRegisterResult;
  }

  const settings = await notifee.requestPermission();
  // 0 is DENIED; anything above is granted in some form.
  if (settings.authorizationStatus === 0) {
    pushLog('registerForPush: POST_NOTIFICATIONS denied — offers will not show');
    return false;
  }

  try {
    const token = await getToken(getMessaging());
    // The token itself is a credential; log only a fingerprint. Its presence proves Play Services
    // and Firebase init are working; a failure here is why a driver silently gets no offers.
    pushLog('registerForPush: got FCM token', { fp: `${token.slice(0, 12)}…`, len: token.length });
    await sendToken(token);
    pushLog('registerForPush: token sent to server ok');
  } catch (cause) {
    // A token fetch or the registration POST failed. Nothing else in the app depends on it, so
    // this stays non-fatal — but it is logged, because it is the single most common reason an
    // otherwise-healthy on-duty driver receives nothing.
    pushLog('registerForPush: FAILED', { error: String(cause) });
    lastRegisterAt = Date.now();
    lastRegisterResult = false;
    return false;
  }

  // Subscribe to rotations ONCE per process, not once per call. FCM rotates on its own schedule;
  // re-subscribing on every `registerForPush` is pointless churn, and on some RNFB builds the act
  // of re-subscribing fires the listener with the current token — a needless extra POST.
  if (unsubscribeFromRefresh === null) {
    unsubscribeFromRefresh = onTokenRefresh(getMessaging(), (next: string) => {
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
  // Clear the rate-limit window too, so going off duty and back on — or signing out and back in —
  // registers straight away rather than trusting a stale "already done" from the previous shift.
  lastRegisterAt = 0;
  lastRegisterResult = false;
}
