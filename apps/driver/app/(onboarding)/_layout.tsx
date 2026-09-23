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
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/*
        The disclosure screen is the one route here that must be ANSWERED rather than escaped.
        Play's Location Permissions policy wants an explicit accept or decline before the
        background-location prompt, so a swipe-back that leaves the question open — and leaves the
        driver's decision unrecorded — is the one interaction it cannot have. Both buttons leave
        the screen; nothing else does.
      */}
      <Stack.Screen name="location-disclosure" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
