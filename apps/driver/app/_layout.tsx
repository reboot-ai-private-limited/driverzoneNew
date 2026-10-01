import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { type ReactElement, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import { SessionProvider } from '@/lib/auth/SessionProvider';
import { useSessionRedirect } from '@/lib/auth/useSessionRedirect';
import { useOfferPushBridge } from '@/notifications/useOfferPushBridge';
import { createQueryClient } from '@/lib/query/client';
import { FONTS_TO_LOAD } from '@/theme/fonts';
import { colors } from '@/theme/theme';

/**
 * The NATIVE splash — the OS-drawn frame before React has mounted — is held here and dismissed
 * as soon as the first screen is ready to paint. `app/index.tsx` is the app's OWN boot screen
 * and does the actual waiting; without this call the two would overlap and the driver would see
 * a white flash between them.
 */
void SplashScreen.preventAutoHideAsync();

export default function RootLayout(): ReactElement | null {
  // Created once, in state, not at module scope: a QueryClient built during a Fast Refresh at
  // module scope is a new cache on every save, and every screen refetches while you are editing.
  const [queryClient] = useState(createQueryClient);

  /**
   * `fontsError` is checked, not ignored: a font that fails to load must not wedge the splash
   * screen open forever. Falling through to render lets the OS default show for that one unlucky
   * launch instead of a boot the driver cannot get past.
   */
  const [fontsLoaded, fontsError] = useFonts(FONTS_TO_LOAD);
  const fontsReady = fontsLoaded || fontsError !== null;

  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady]);

  /**
   * Notification channels, and routing a tapped or full-screen offer to the ring screen.
   *
   * Lives in the ROOT layout because both jobs outlive any one screen: the channels must exist
   * before the first push can be displayed, and a full-screen intent can land the app on this
   * tree when no screen of ours has ever mounted.
   *
   * Called before the `fontsReady` early return so it is never conditionally skipped — a hook
   * after that line would violate the rules of hooks on the very first render.
   */
  useOfferPushBridge();

  /**
   * Sending a driver to the login screen when the session ends WITHOUT them asking.
   *
   * Here for the same reason as the bridge above: it must outlive any one screen, since the whole
   * point is the case where the driver is sitting on Home or a live trip when the refresh is
   * rejected. Also called before the `fontsReady` early return, so it is never conditionally
   * skipped.
   */
  useSessionRedirect();

  // Nothing paints until the typeface is in — the native splash is still covering the screen at
  // this point, so this is invisible, not a flash of blank white.
  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={styles.flex}>
      {/*
        `initialMetrics` seeds the provider with insets read natively at startup. Without it the
        FIRST render of every screen sees zeros and only corrects after a layout pass — which on
        a screen that paints immediately shows as content sitting under the status bar.
      */}
      {/*
        KEYBOARD INSETS FOR EVERY SCREEN. Android draws edge-to-edge from Android 15, and in that
        mode `adjustResize` no longer shrinks the window around the keyboard — so the old
        `KeyboardAvoidingView behavior={ios ? 'padding' : undefined}` did nothing on Android and
        fields near the bottom were typed into blind. `react-native-keyboard-controller` reads the
        real keyboard insets on both platforms; screens use its `KeyboardAwareScrollView`.
      */}
      <KeyboardProvider>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            {/*
              `style="dark"` means DARK GLYPHS, for our light backgrounds — white cards and the
              yellow header. Reading it as "dark theme" is the common misreading and gives you
              white-on-yellow, which is invisible.
            */}
            <StatusBar style="dark" />

            {/*
              THE APP IS CONFINED BETWEEN THE SYSTEM BARS, and this is the single place that
              decides it. Android draws edge-to-edge unconditionally from Android 15, so by
              default a screen's background fills the area behind the clock and the gesture pill.
              This `SafeAreaView` insets the whole navigator instead.

              Because it applies once here, individual screens must NOT add `insets.top` or
              `insets.bottom` of their own; doing so pads twice. Content rendered OUTSIDE this
              tree — a `Modal`, which the platform hoists to its own window — is the exception.

              When the full-screen trip offer lands (docs/LLD/driver-app.md S-9) it is one of
              those exceptions: a ringing offer deliberately covers the status bar.
            */}
            <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg },
                  animation: 'slide_from_right',
                }}
              />
            </SafeAreaView>
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  /** The colour the status bar and navigation bar are painted, since nothing draws under them. */
  safeArea: { flex: 1, backgroundColor: colors.bg },
});
