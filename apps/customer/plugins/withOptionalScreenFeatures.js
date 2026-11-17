const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Play Console blocks the release when `android.hardware.screen.portrait` is a hard requirement:
 * a portrait-locked activity makes Android imply it, and devices without a portrait screen
 * (some tablets, desktops, XR) then cannot install the app. Declaring the features explicitly as
 * `required="false"` overrides the implied requirement; the app stays portrait-locked.
 */
const FEATURES = ['android.hardware.screen.portrait', 'android.hardware.screen.landscape'];

module.exports = function withOptionalScreenFeatures(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const list = (manifest['uses-feature'] ??= []);
    for (const name of FEATURES) {
      const existing = list.find((f) => f.$['android:name'] === name);
      if (existing) existing.$['android:required'] = 'false';
      else list.push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
    return cfg;
  });
};
