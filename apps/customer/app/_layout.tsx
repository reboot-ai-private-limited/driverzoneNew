import { StyleSheet } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { type ReactElement, useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { SessionProvider } from '@/lib/auth/SessionProvider';
import { useNotificationBridge } from '@/notifications/useNotificationBridge';
import { createQueryClient } from '@/lib/query/client';
import { colors } from '@/theme/theme';
import { FONTS_TO_LOAD } from '@/theme/fonts';

/**
 * The NATIVE splash — the OS-drawn frame before React has mounted — is held here and dismissed
 * as soon as the first screen is ready to paint. `app/index.tsx` is the app's OWN boot screen
 * and does the actual waiting; without this call the two would overlap and the customer would
 * see a white flash between them.
 */
void SplashScreen.preventAutoHideAsync();

export default function RootLayout(): ReactElement | null {
  // Created once, in state, not at module scope: a QueryClient built during a Fast Refresh at
  // module scope is a new cache on every save, and every screen refetches while you are editing.
  const [queryClient] = useState(createQueryClient);

  /**
   * `fontsError` is checked, not ignored: a font that fails to load (a corrupt asset, a platform
   * that refuses the format) must not wedge the splash screen open forever. Falling through to
   * render lets the OS default show for that one unlucky launch instead of a boot the customer
   * cannot get past — a stray glyph is a much smaller failure than an app that will not open.
   */
  const [fontsLoaded, fontsError] = useFonts(FONTS_TO_LOAD);
  const fontsReady = fontsLoaded || fontsError !== null;

  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady]);

  // Nothing paints until the typeface is in — the native splash is still covering the screen at
  // this point, so this is invisible, not a flash of blank white.
  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/*
        `initialMetrics` seeds the provider with insets read natively at startup. Without it the
        FIRST render of every screen sees zeros and only corrects after a layout pass — which on
        a screen that paints immediately shows as content sitting under the status bar, sometimes
        without ever settling if nothing forces a re-layout.
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
              Push: creates the notification channel, registers this handset once the session is
              authenticated, and routes a tapped ride-update notification to the trip screen.
              Inside `SessionProvider` because it reads the session; renders nothing.
            */}
            <NotificationBridge />

            {/*
              `style="dark"` means DARK GLYPHS, for our light backgrounds — white cards and the
              yellow header. Reading it as "dark theme" is the common misreading and gives you
              white-on-yellow, which is invisible.

              There is no `translucent` prop any more: SDK 57 removed it because Android draws
              edge-to-edge unconditionally from Android 15, so the app ALWAYS extends under the
              status bar and the gesture pill. Every screen therefore pads itself with
              `useSafeAreaInsets()`. Those values are per-device — no fixed padding is correct.
            */}
            <StatusBar style="dark" />

            {/*
              THE APP IS CONFINED BETWEEN THE SYSTEM BARS, and this is the single place that
              decides it.

              Android draws edge-to-edge unconditionally from Android 15, so by default a screen's
              background fills the area behind the clock and the gesture pill. This `SafeAreaView`
              insets the whole navigator instead, leaving the bars painted in `colors.bg` — so no
              screen, present or future, can reach under them.

              Because it applies once here, individual screens must NOT add `insets.top` or
              `insets.bottom` of their own; doing so pads twice. Content rendered OUTSIDE this
              tree — a `Modal`, which the platform hoists to its own window — is the exception
              and still handles its own insets.
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

/** Draws nothing — it exists so `useNotificationBridge` runs inside the `SessionProvider` tree. */
function NotificationBridge(): null {
  useNotificationBridge();
  return null;
}

const styles = StyleSheet.create({
  /** The colour the status bar and navigation bar are painted, since nothing draws under them. */
  safeArea: { flex: 1, backgroundColor: colors.bg },
});
