import { Stack } from 'expo-router';
import type { ReactElement } from 'react';

/**
 * A route GROUP — the parentheses keep `(auth)` out of the URL, so these screens are `/phone`
 * and `/otp`. It exists to give the login flow its own stack options without those leaking to
 * the signed-in screens.
 */
export default function AuthLayout(): ReactElement {
  return <Stack screenOptions={{ headerShown: false }} />;
}
