/**
 * One tagged logger for the whole push path.
 *
 * `[dz-push]` on every line, through `console.log`, because that is the one thing that survives to
 * a customer's handset: `adb logcat -s ReactNativeJS:V | grep dz-push` is how a field problem
 * gets diagnosed, and the FCM path has no screen to show an error on. Not gated behind `__DEV__`
 * — the release build is exactly where these matter — and the volume is a handful of lines per
 * notification, which costs nothing.
 */
export function pushLog(event: string, detail?: Record<string, unknown>): void {
  const suffix = detail === undefined ? '' : ` ${JSON.stringify(detail)}`;
  // eslint-disable-next-line no-console -- the one place console is the right tool; see above.
  console.log(`[dz-push] ${event}${suffix}`);
}
