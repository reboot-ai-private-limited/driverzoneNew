import { Stack } from 'expo-router';
import type { ReactElement } from 'react';

/**
 * A route GROUP — the parentheses keep `(onboarding)` out of the URL, so these screens are
 * `/onboarding-status`, `/onboarding-profile` and `/onboarding-documents`.
 *
 * The filenames keep the `onboarding-` prefix even though the group already says it, because
 * `screenForMissing()` in `features/onboarding/requirements.ts` builds those paths from the
 * server's dot-paths and a bare `/profile` would collide with the account tab.
 */
export default function OnboardingLayout(): ReactElement {
  return <Stack screenOptions={{ headerShown: false }} />;
}
