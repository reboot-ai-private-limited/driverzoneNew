const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Declines two permissions this app never uses but which its DEPENDENCIES request on its behalf.
 *
 *   `SYSTEM_ALERT_WINDOW`  — React Native core, for the dev-menu overlay. Release builds have no
 *                            dev menu, and nothing in this app draws over other apps.
 *
 *   `SCHEDULE_EXACT_ALARM` — `app.notifee:core`, which declares it so that apps using trigger
 *                            notifications can fire them on time. THIS APP HAS NO TRIGGER
 *                            NOTIFICATIONS: there is not one `createTriggerNotification` in the
 *                            tree. Every notification it shows arrives as an FCM push from the
 *                            server — driver assigned, driver arrived, trip complete — with no
 *                            alarm scheduled on the handset at all.
 *
 *                            Worth removing rather than ignoring, because it is not a quiet one:
 *                            Play requires an "Exact alarms" declaration from any app targeting
 *                            API 33+ that requests it, and grants it only where alarms or
 *                            calendaring are the core function. Dropping it removes a whole
 *                            declaration — and a plausible rejection — from the release.
 *
 * **THERE ARE TWO STAGES AT WHICH A PERMISSION CAN ARRIVE, and this plugin has to answer both.**
 * That distinction is the whole design of this file, and it is easy to get wrong in a way that
 * looks like it worked:
 *
 *   1. PREBUILD — `app.json`'s own list plus anything the config plugins write. This is the
 *      manifest at `android/app/src/main/AndroidManifest.xml`, and a permission here can simply
 *      be filtered out of the array. `SYSTEM_ALERT_WINDOW` arrives this way.
 *
 *   2. GRADLE MANIFEST MERGE — every dependency's own `AndroidManifest.xml` is merged into the
 *      app's at BUILD time, long after this plugin has run. `SCHEDULE_EXACT_ALARM` and `CAMERA`
 *      arrive this way, and neither appears anywhere in the prebuild manifest. A filter cannot
 *      touch them; checking the prebuild output would show them absent and the APK would ship
 *      them anyway.
 *
 * So for every entry in `STRIP` this plugin leaves behind a `tools:node="remove"` directive, which
 * is an instruction TO the merger rather than a request of the OS. It deletes the permission at
 * stage 2 no matter which library supplied it, and covers stage 1 as a side effect. Verify in
 * `android/app/build/intermediates/merged_manifest/release/.../AndroidManifest.xml` — the merged
 * file — never in the prebuild one.
 *
 * **`RECORD_AUDIO` and `CAMERA` are NOT here.** They used to arrive with `expo-image-picker`,
 * which has since been removed from this app entirely (no profile photo upload), so nothing
 * requests them any more. The historical note below is kept for context.
 *
 * Historically: `expo-image-picker` offered the block at source — `["expo-image-picker",
 * { "microphonePermission": false, "cameraPermission": false }]` made its plugin emit exactly
 * these directives.
 * Preferring a library's supported option over a local override keeps the reason next to the
 * dependency that caused it. Both are honest: `profile-setup.tsx` calls
 * `launchImageLibraryAsync({ mediaTypes: ['images'] })` — library only, stills only, no camera and
 * no video — and this app has no audio dependency at all.
 *
 * A plugin rather than an edit to the generated manifest, for the same reason as
 * `withUpiQueries.js`: `android/` is gitignored and rebuilt from scratch by `expo prebuild`, so
 * anything hand-edited there is silently lost on the next run.
 *
 * **If a future feature genuinely needs one of these, delete it from `STRIP`** rather than working
 * around this plugin. A removed permission is a very quiet bug: the JS call succeeds, the native
 * side refuses, and nothing on either side explains why.
 */
const STRIP = ['android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.SCHEDULE_EXACT_ALARM'];

module.exports = function withStripPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    /*
     * `tools:` has to be bound on the root element or the merger rejects the directive outright.
     * Prebuild already declares it — every generated manifest uses `tools:replace` somewhere — but
     * asserting it costs nothing and the failure it prevents is a build error with a stack trace
     * pointing at the manifest rather than at this file.
     */
    manifest.$ = manifest.$ ?? {};
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';

    for (const key of ['uses-permission', 'uses-permission-sdk-23']) {
      const declared = manifest[key];
      if (!Array.isArray(declared)) continue;

      /*
       * Drop the plain grants, and ANY directive already targeting one of ours — re-adding it
       * below is what keeps this idempotent across repeated prebuilds and stops a duplicate entry
       * for the same permission, which the merger treats as a conflict rather than a repetition.
       */
      manifest[key] = declared.filter((entry) => !STRIP.includes(entry.$?.['android:name']));
    }

    const removals = STRIP.map((name) => ({
      $: { 'android:name': name, 'tools:node': 'remove' },
    }));

    manifest['uses-permission'] = [...(manifest['uses-permission'] ?? []), ...removals];

    return cfg;
  });
};
