/**
 * A single tagged logger for the whole notification path.
 *
 * Every line goes through `console.log` with a `[dz-push]` prefix, which is the one thing that
 * survives to a driver's handset: `adb logcat -s ReactNativeJS:V | grep dz-push` is how a field
 * problem gets diagnosed, and the FCM path is the part of this app with no screen to show an
 * error on. Kept deliberately chatty — an offer that never rings is the worst failure this app
 * has, and a silent success is indistinguishable from a silent drop without these.
 *
 * Not gated behind `__DEV__`: the release build is exactly where these matter, because that is
 * the build that reaches a real phone in a real dead zone. The volume is a handful of lines per
 * offer, which costs nothing.
 */
export function pushLog(event: string, detail?: Record<string, unknown>): void {
  const suffix = detail === undefined ? '' : ` ${JSON.stringify(detail)}`;
  // eslint-disable-next-line no-console -- the one place console is the right tool; see above.
  console.log(`[dz-push] ${event}${suffix}`);
}
