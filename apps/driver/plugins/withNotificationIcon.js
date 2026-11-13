const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The brand accent colour (#F2F200) for notifications Android draws itself — FCM pushes with a
 * `notification` block, while the app is in the background — so they match the app-drawn ones.
 *
 * COLOUR ONLY. The small icon is deliberately left to Android's default, the app launcher icon
 * (the DriverZone logo), which is what the product wants shown. A custom monochrome car icon was
 * tried and reverted — do not add a `default_notification_icon` / `smallIcon` back.
 *
 * Writes `res/values/notification_color.xml` and the matching manifest meta-data.
 */
const COLOR = `<resources>
  <color name="notification_color">#F2F200</color>
</resources>
`;

const META = [
  ['com.google.firebase.messaging.default_notification_color', '@color/notification_color'],
];

module.exports = function withNotificationIcon(config) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const res = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      fs.mkdirSync(path.join(res, 'values'), { recursive: true });
      fs.writeFileSync(path.join(res, 'values', 'notification_color.xml'), COLOR);
      return cfg;
    },
  ]);

  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ ?? {};
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
    const app = manifest.application[0];
    app['meta-data'] = app['meta-data'] ?? [];
    for (const [name, value] of META) {
      const existing = app['meta-data'].find((m) => m.$['android:name'] === name);
      // `tools:replace` because @react-native-firebase/messaging declares the colour key too
      // (from firebase.json); without it the manifest merger fails the build on the conflict.
      const attrs = { 'android:name': name, 'android:resource': value, 'tools:replace': 'android:resource' };
      if (existing) existing.$ = attrs;
      else app['meta-data'].push({ $: attrs });
    }
    return cfg;
  });
};
