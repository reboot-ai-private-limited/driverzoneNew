import notifee from '@notifee/react-native';
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
export type OemFamily =
  | 'xiaomi'
  | 'oppo'
  | 'vivo'
  | 'samsung'
  | 'motorola'
  | 'nothing'
  | 'lava'
  | 'generic';

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
  // `motorola` in both fields, lowercase, on every Moto handset — the Lenovo ownership does not
  // show up here. Matched before the near-stock families below because My UX, despite looking
  // like stock, keeps its per-app battery control somewhere the generic copy does not name.
  if (/motorola/.test(haystack)) return 'motorola';
  // Nothing OS is near-stock AOSP and reports "Nothing" in both fields. It gets its own entry
  // not because it is hostile — it is one of the better-behaved skins — but because the generic
  // copy names screens that Nothing labels differently, and a step that does not match what is
  // on the driver's screen is a step they abandon.
  if (/nothing/.test(haystack)) return 'nothing';
  // Lava ships close to stock on its mid-range, so the settings paths are the standard ones. The
  // reason it is called out separately is RAM: the budget models this brand sells most of will
  // reclaim a backgrounded process under memory pressure no matter how it is configured, and the
  // guidance has to be honest that keeping the app open matters more here than elsewhere.
  if (/lava/.test(haystack)) return 'lava';
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
      'In Settings → Battery → Background usage limits, remove DriverZone from Sleeping apps and Deep sleeping apps.',
      'In the same screen, add DriverZone to Never sleeping apps.',
      // One UI turns this back on by itself after an update, and it is what quietly re-sleeps the
      // app weeks after a driver followed every other step.
      'Still in Background usage limits, turn OFF "Put unused apps to sleep".',
    ],
  },
  motorola: {
    family: 'motorola',
    skinLabel: 'My UX (Motorola)',
    steps: [
      'Open the button below, then open App battery usage and choose Unrestricted.',
      // The per-app setting above is the one that matters, but Moto ships a second, global switch
      // that silently overrides it — a driver who sets only the first still gets throttled.
      'In Settings → Battery, open Battery optimisation and set DriverZone to Don’t optimise.',
      // My UX is close to stock and has no autostart list; saying so stops a driver hunting for
      // one because the other guides mention it.
      'There is no autostart list on Motorola — those two settings are all it needs.',
    ],
  },
  nothing: {
    family: 'nothing',
    skinLabel: 'Nothing OS',
    steps: [
      'Open the button below, then open App battery usage and choose Unrestricted.',
      'Back in Settings → Battery, make sure Battery saver is off while you are driving.',
      // Nothing OS has no autostart list — Adaptive Battery is the only thing left that can
      // deprioritise the app, and it learns from usage rather than from a switch.
      'That is all Nothing OS needs — it has no separate autostart list.',
    ],
  },
  lava: {
    family: 'lava',
    skinLabel: 'Lava',
    steps: [
      'Open the button below and choose Battery.',
      'Set battery usage to Unrestricted (or turn off Optimise) for DriverZone.',
      // Only some Lava models ship a security/autostart app; the button below is a no-op where
      // there is none, so this is worded as a conditional rather than an instruction.
      'If your phone has a Security or Phone Master app, open it and add DriverZone to Autostart.',
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

  /*
   * Notifee first. It ships the same "stop optimising this app" dialog, but resolves the intent
   * against its own maintained table of OEM quirks rather than assuming the AOSP action exists —
   * which is the difference between a working shortcut and a dead button on the skins that
   * renamed it. Ours stays below as the fallback for anything its table does not know.
   */
  try {
    await notifee.openBatteryOptimizationSettings();
    return;
  } catch {
    // Notifee could not resolve it either — fall through to the raw intents.
  }

  /*
   * THIS ONE IS EXPECTED TO FAIL NOW, and is kept only because failing costs nothing.
   *
   * `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is the one-tap dialog, and it is the only
   * battery intent that requires holding `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. That permission
   * was dropped from `app.json`: Play restricts it to a narrow allowlist of use cases that
   * driver dispatch is not on, so carrying it meant defending a permission we do not need in
   * order to save a tap. Without the grant Android refuses to resolve this action, we land in
   * the `catch`, and the driver gets the settings LIST below instead — same destination, one
   * more tap, no policy surface.
   *
   * Left in place rather than deleted because Notifee above already handles most handsets, and
   * because a build that does re-acquire the permission for some reason should get the better
   * dialog back without anyone having to remember this function exists.
   */
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: packageData() },
    );
    return;
  } catch {
    // Permission not held — by design. Fall through to the list, which needs no permission.
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

  /*
   * Notifee's power-manager table first, for the same reason as the battery dialog above: it
   * covers far more skins than the three below — Transsion (Tecno, Infinix, itel), Huawei, Asus,
   * Meizu and others that sell heavily into this market — and it is maintained upstream rather
   * than by us. `hasPowerManager()` is what the UI uses to decide whether to offer this at all,
   * so reaching here usually means there IS one.
   */
  try {
    await notifee.openPowerManagerSettings();
    return;
  } catch {
    // No known power manager on this device, or the activity moved — fall through.
  }

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
 * Does this DEVICE have an OEM autostart / power manager worth sending the driver to?
 *
 * Asked of the device rather than inferred from the family, which is the point. The screen used to
 * show its "Open autostart settings" button for every family except `samsung` and `generic` — so a
 * Nothing or stock-Android handset with no such screen got no button (correct, but by luck), while
 * a Transsion or Huawei handset that has one got none either (wrong). Notifee answers from its own
 * table of real activities, so the button now appears exactly when there is something behind it.
 *
 * Fails closed: if the lookup throws, the button is hidden. A missing shortcut costs the driver
 * one manual trip through Settings; a button that opens nothing costs their trust in the screen.
 */
export async function hasPowerManager(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const info = await notifee.getPowerManagerInfo();
    return info.activity !== null && info.activity !== undefined;
  } catch {
    return false;
  }
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
