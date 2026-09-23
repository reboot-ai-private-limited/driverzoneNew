const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Declines two permissions this app never uses but which its DEPENDENCIES request on its behalf.
 *
 *   `SYSTEM_ALERT_WINDOW`  — React Native core, for the dev-menu overlay. Release builds have no
 *                            dev menu. The ring-over-lock-screen behaviour does NOT depend on it:
 *                            `withRingOverLockScreen.js` gets there with `showWhenLocked` /
 *                            `turnScreenOn` activity attributes plus Notifee's `fullScreenAction`,
 *                            which is the incoming-call mechanism rather than an overlay.
 *
 *   `SCHEDULE_EXACT_ALARM` — `app.notifee:core`, which declares it so that apps using trigger
 *                            notifications can fire them on time. THIS APP HAS NO TRIGGER
 *                            NOTIFICATIONS: there is not one `createTriggerNotification` in the
 *                            tree. Every ring is driven by an FCM push from the server, including
 *                            the scheduled-booking early ring — the schedule lives in the backend,
 *                            not in an alarm on the handset.
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
 * **`RECORD_AUDIO` and `CAMERA` are NOT here, deliberately.** Both come from `expo-image-picker`,
 * which offers the same block at source: `["expo-image-picker", { "microphonePermission": false,
 * "cameraPermission": false }]` in `app.json` makes its own plugin emit exactly these directives.
 * Preferring a library's supported option over a local override keeps the reason next to the
 * dependency that caused it. Both are honest: `onboarding-documents.tsx` and
 * `onboarding-profile.tsx` call `launchImageLibraryAsync({ mediaTypes: ['images'] })` — library
 * only, stills only, no camera and no video — and `useOfferRing.ts` uses `createAudioPlayer`,
 * playback with no recorder anywhere in the app.
 *
 * (`expo-audio` is deliberately NOT listed in `app.json`. Its config plugin is not autolinked, so
 * listing it in order to pass `recordAudioAndroid: false` would activate the rest of its defaults
 * and ADD `MODIFY_AUDIO_SETTINGS` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK` — two permissions this
 * app does not have today. The image-picker block already covers RECORD_AUDIO for both.)
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
