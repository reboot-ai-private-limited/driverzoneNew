const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Android 11 (API 30) locked package visibility: an app can no longer see whether GPay, PhonePe
 * or Paytm are installed unless it declares WHY it needs to ask. Razorpay's checkout resolves the
 * UPI app list with `PackageManager.queryIntentActivities` against `upi://pay` — without this
 * `<queries>` block that call comes back empty on a real Android 11+ device, and the checkout
 * shows no UPI apps at all even though they're installed. Emulators without Play Services often
 * hide this locally since they have neither app installed either way; it only shows up on a real
 * phone, which is why it's declared here rather than discovered from a bug report.
 *
 * A plugin, not a hand-edited `android/app/src/main/AndroidManifest.xml`, because this app has no
 * checked-in native project — `expo prebuild` regenerates `android/` from scratch, and anything
 * edited there directly is silently lost on the next prebuild.
 */
module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    if (!Array.isArray(manifest.queries)) {
      manifest.queries = [];
    }

    const alreadyPresent = manifest.queries.some((entry) =>
      (entry.intent ?? []).some(
        (intent) =>
          (intent.action ?? []).some((a) => a.$?.['android:name'] === 'android.intent.action.VIEW') &&
          (intent.data ?? []).some((d) => d.$?.['android:scheme'] === 'upi'),
      ),
    );

    if (!alreadyPresent) {
      manifest.queries.push({
        intent: [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
            data: [{ $: { 'android:scheme': 'upi' } }],
          },
        ],
      });
    }

    return config;
  });
};
