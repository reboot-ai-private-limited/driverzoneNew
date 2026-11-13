import notifee, { AuthorizationStatus } from '@notifee/react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';
import { canUseFullScreenIntent, isDndAccessGranted } from '../../../modules/permission-health';
import { openFullScreenIntentSettings } from '@/notifications/fullScreenIntent';
import { OFFER_CHANNEL_ID } from '@/notifications/channel';
import { isBatteryOptimisationActive } from './batteryOptimisation';

/**
 * EVERY GRANT A RINGING OFFER DEPENDS ON, read live — never from a stored "the driver said yes"
 * flag. A stored flag is how the old flow went wrong: a driver who declined once was never asked
 * again, and one whose OEM update silently re-enabled battery optimisation was believed to be fine.
 *
 * Re-read on every Home focus and every return from Settings, so fixing an item makes it vanish
 * the moment the driver comes back.
 *
 * `required` items mean offers WILL be missed; `recommended` ones mean they MAY be.
 */
export type PermissionIssueId =
  | 'notifications'
  | 'offer-channel'
  | 'location'
  | 'background-location'
  | 'full-screen'
  | 'battery'
  | 'dnd';

export interface PermissionIssue {
  id: PermissionIssueId;
  severity: 'required' | 'recommended';
  title: string;
  body: string;
  action: string;
}

const ISSUES: Record<PermissionIssueId, Omit<PermissionIssue, 'id'>> = {
  notifications: {
    severity: 'required',
    title: 'Notifications are off',
    body: 'Trip offers cannot ring while notifications are blocked.',
    action: 'Turn on',
  },
  'offer-channel': {
    severity: 'required',
    title: 'Trip offer alerts are muted',
    body: 'The "Trip offers" notification category is turned off.',
    action: 'Turn on',
  },
  location: {
    severity: 'required',
    title: 'Location is off',
    body: 'Nearby trips are matched on your location.',
    action: 'Allow',
  },
  'full-screen': {
    severity: 'required',
    title: 'Offers cannot wake your screen',
    body: 'Allow full-screen alerts so an offer rings like a call when the phone is locked.',
    action: 'Allow',
  },
  'background-location': {
    severity: 'recommended',
    title: 'Background location is off',
    body: 'You may be taken offline if Android closes the app while the screen is locked.',
    action: 'Allow',
  },
  battery: {
    severity: 'recommended',
    title: 'Battery saver can silence offers',
    body: 'Your phone may stop DriverZone in the background.',
    action: 'Fix',
  },
  dnd: {
    severity: 'recommended',
    title: 'Offers are silent in Do Not Disturb',
    body: 'Allow Do Not Disturb access so offers still ring.',
    action: 'Allow',
  },
};

const ORDER: PermissionIssueId[] = [
  'notifications',
  'offer-channel',
  'location',
  'full-screen',
  'background-location',
  'battery',
  'dnd',
];

/** Each check swallows its own failure: a check that cannot answer must never invent a problem. */
async function safe(check: () => Promise<boolean> | boolean): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}

export async function checkPermissionHealth(): Promise<PermissionIssue[]> {
  if (Platform.OS !== 'android') return [];

  const [notificationsOff, channelOff, locationOff, backgroundOff, batteryOn] = await Promise.all([
    safe(async () => {
      const settings = await notifee.getNotificationSettings();
      return settings.authorizationStatus === AuthorizationStatus.DENIED;
    }),
    safe(async () => {
      const channel = await notifee.getChannel(OFFER_CHANNEL_ID);
      // `null` = not created yet (first launch) — not a driver-fixable problem.
      return channel !== null && channel.blocked === true;
    }),
    safe(async () => !(await Location.getForegroundPermissionsAsync()).granted),
    safe(async () => !(await Location.getBackgroundPermissionsAsync()).granted),
    safe(isBatteryOptimisationActive),
  ]);

  const found = new Set<PermissionIssueId>();
  if (notificationsOff) found.add('notifications');
  else if (channelOff) found.add('offer-channel');
  if (locationOff) found.add('location');
  // Only worth raising once the foreground grant exists — Android will not offer it before.
  else if (backgroundOff) found.add('background-location');
  if (canUseFullScreenIntent() === false) found.add('full-screen');
  if (batteryOn) found.add('battery');
  // DND access only matters once notifications themselves work.
  if (!notificationsOff && isDndAccessGranted() === false) found.add('dnd');

  return ORDER.filter((id) => found.has(id)).map((id) => ({ id, ...ISSUES[id] }));
}

/**
 * One tap per issue. Prompts where Android still allows a prompt, otherwise lands on the exact
 * settings screen — a driver who has to hunt through Settings will not.
 */
export async function fixPermissionIssue(id: PermissionIssueId): Promise<void> {
  try {
    switch (id) {
      case 'notifications': {
        const result = await notifee.requestPermission();
        if (result.authorizationStatus === AuthorizationStatus.DENIED) {
          await notifee.openNotificationSettings();
        }
        return;
      }
      case 'offer-channel':
        await notifee.openNotificationSettings(OFFER_CHANNEL_ID);
        return;
      case 'location': {
        const current = await Location.getForegroundPermissionsAsync();
        if (current.canAskAgain) {
          await Location.requestForegroundPermissionsAsync();
        } else {
          await Linking.openSettings();
        }
        return;
      }
      case 'background-location':
        // Through the prominent disclosure every time — Play requires it right before the prompt,
        // and it is also the screen that clears a remembered "Not now".
        router.push('/location-disclosure');
        return;
      case 'full-screen':
        await openFullScreenIntentSettings();
        return;
      case 'battery':
        router.push('/battery-setup');
        return;
      case 'dnd':
        await IntentLauncher.startActivityAsync('android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS');
        return;
    }
  } catch {
    await Linking.openSettings().catch(() => undefined);
  }
}
