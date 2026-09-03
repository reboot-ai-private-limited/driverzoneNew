import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

/**
 * OEM battery-manager guidance — the hand-maintained core of the highest-leverage screen in the
 * app (docs/engineering/mobile-in-monorepo.md, docs/LLD/driver-app.md S-12).
 *
 * Xiaomi, Oppo, Vivo, Realme and Samsung ship battery managers that kill a backgrounded app and
 * delay or drop its notifications, sometimes by minutes. A trip offer that never rings is a
 * driver who looks idle to dispatch. No API and no permission fixes this from inside the app —
 * the driver has to change a setting the OEM buried, and every skin buries it somewhere else.
 *
 * **This list rots.** The activity names below are internal to each skin and get renamed or
 * removed between versions. So every deep link is best-effort: it is tried, and on any failure
 * the code falls back to this app's own system settings page, which on every Android has a
 * Battery entry the driver can set to "Unrestricted". The written steps are the real payload;
 * the deep link is a shortcut that may or may not land.
 */

/** The buckets we have specific guidance for. `generic` is the honest fallback for everything else. */
export type OemFamily = 'xiaomi' | 'oppo' | 'vivo' | 'samsung' | 'generic';

export interface OemGuide {
  family: OemFamily;
  /** What the driver sees named on their phone, e.g. "MIUI / HyperOS". */
  skinLabel: string;
  /** Ordered, plain-language. Each string is one thing to do. */
  steps: string[];
}

/**
 * Map a manufacturer/brand string to a family.
 *
 * Both are checked because they disagree: a Poco phone reports manufacturer `Xiaomi` but brand
 * `POCO`, and a rebadged device can carry an ODM name in one field and the retail brand in the
 * other.
 */
export function detectOemFamily(): OemFamily {
  if (Platform.OS !== 'android') return 'generic';

  const constants = Platform.constants as { Manufacturer?: string; Brand?: string };
  const haystack = `${constants.Manufacturer ?? ''} ${constants.Brand ?? ''}`.toLowerCase();

  if (/xiaomi|redmi|poco/.test(haystack)) return 'xiaomi';
  if (/oppo|realme|oneplus/.test(haystack)) return 'oppo';
  if (/vivo|iqoo/.test(haystack)) return 'vivo';
  if (/samsung/.test(haystack)) return 'samsung';
  return 'generic';
}

const GUIDES: Record<OemFamily, OemGuide> = {
  xiaomi: {
    family: 'xiaomi',
    skinLabel: 'MIUI / HyperOS (Xiaomi, Redmi, Poco)',
    steps: [
      'Open the button below, then turn on Autostart for DriverZone.',
      'Back in app settings, open Battery saver (or Battery) and set it to No restrictions.',
      'In Other permissions, allow "Display pop-up windows while running in the background".',
    ],
  },
  oppo: {
    family: 'oppo',
    skinLabel: 'ColorOS (Oppo, Realme, OnePlus)',
    steps: [
      'Open the button below, then in Battery turn Allow background activity on.',
      'Turn off Battery optimisation for DriverZone (choose Don’t optimise).',
      'In the phone’s Startup manager or Auto-launch list, enable DriverZone.',
    ],
  },
  vivo: {
    family: 'vivo',
    skinLabel: 'Funtouch OS / OriginOS (Vivo, iQOO)',
    steps: [
      'Open the button below, then in Battery turn on Allow high background power use.',
      'Turn off Background power consumption limits for DriverZone.',
      'In the phone’s Auto-start list, enable DriverZone.',
    ],
  },
  samsung: {
    family: 'samsung',
    skinLabel: 'One UI (Samsung)',
    steps: [
      'Open the button below, then in Battery set usage to Unrestricted.',
      'In Settings → Battery → Background usage limits, remove DriverZone from Sleeping apps and add it to Never sleeping apps.',
    ],
  },
  generic: {
    family: 'generic',
    skinLabel: 'Android',
    steps: [
      'Open the button below and choose Battery.',
      'Set battery usage to Unrestricted (or turn off Optimise) for DriverZone.',
    ],
  },
};

export function guideFor(family: OemFamily): OemGuide {
  return GUIDES[family];
}

/** `package:in.driverzone.driver`, or Expo Go's package when running there. */
function packageData(): string {
  const pkg = Constants.expoConfig?.android?.package ?? 'in.driverzone.driver';
  return `package:${pkg}`;
}

/**
 * Best-effort open of this app's system settings page.
 *
 * `APPLICATION_DETAILS_SETTINGS` is the one screen that exists on every Android and every skin,
 * with a Battery entry inside it — so it is the floor every other attempt falls back to.
 */
async function openAppDetails(): Promise<void> {
  try {
    await IntentLauncher.startActivityAsync('android.settings.APPLICATION_DETAILS_SETTINGS', {
      data: packageData(),
    });
  } catch {
    // Absolute last resort. In Expo Go this opens Expo Go's own settings, which still has a
    // Battery entry — not ideal, correct in a real build.
    await Linking.openSettings();
  }
}

/**
 * Take the driver to the place where they can lift battery restrictions.
 *
 * Tries, in order: the direct "ignore battery optimisation" dialog (needs the manifest
 * permission from S-13, so it only works in a real build), then the full optimisation LIST,
 * then this app's settings page. Any throw drops to the next.
 */
export async function openBatterySettings(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: packageData() },
    );
    return;
  } catch {
    // permission not granted / not a dev build — fall through
  }

  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
    );
    return;
  } catch {
    // some skins remove this list — fall through
  }

  await openAppDetails();
}

/**
 * Autostart / background-activity managers are OEM-specific activities that get renamed between
 * versions, so this is deliberately thin: try the one component we know for the family, and on
 * any failure send the driver to the app settings page with the written steps still on screen.
 */
export async function openAutostartSettings(family: OemFamily): Promise<void> {
  if (Platform.OS !== 'android') return;

  const component = AUTOSTART_COMPONENTS[family];
  if (component !== undefined) {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
        packageName: component.packageName,
        className: component.className,
      });
      return;
    } catch {
      // renamed / removed on this version — fall through
    }
  }

  await openAppDetails();
}

/**
 * Known autostart activities per skin. Correct on the versions current when written; expect to
 * update these. `samsung` and `generic` have none worth targeting — One UI folds it into the
 * standard battery screen, which `openAppDetails` already reaches.
 */
const AUTOSTART_COMPONENTS: Partial<Record<OemFamily, { packageName: string; className: string }>> = {
  xiaomi: {
    packageName: 'com.miui.securitycenter',
    className: 'com.miui.permcenter.autostart.AutoStartManagementActivity',
  },
  oppo: {
    packageName: 'com.coloros.safecenter',
    className: 'com.coloros.safecenter.permission.startup.StartupAppListActivity',
  },
  vivo: {
    packageName: 'com.vivo.permissionmanager',
    className: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity',
  },
};
