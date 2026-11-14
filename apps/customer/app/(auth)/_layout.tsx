import type { ReactElement } from 'react';
import { Stack } from 'expo-router';

/**
 * A route GROUP — the parentheses keep `(auth)` out of the URL, so these screens are `/phone`
 * and `/otp`. It exists to give the login flow its own stack options without those leaking to
 * the signed-in screens.
 */
export default function AuthLayout(): ReactElement {
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', animationDuration: 240 }} />;
}
