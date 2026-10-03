import { FontAwesome5, MaterialCommunityIcons, Octicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs, router } from 'expo-router';
import type { BottomTabNavigationOptions } from 'expo-router/build/react-navigation/bottom-tabs';
import { type ReactElement, useEffect } from 'react';
import { TabBar } from '@/components/TabBar';
import { DEFAULT_HISTORY_VIEW, rideHistoryQuery } from '@/features/rides/historyQuery';

/** How long after the home screen settles before the other tabs are built in the background. */
const PRELOAD_DELAY_MS = 1200;

/**
 * Every tab switch: INSTANT, with hidden tabs frozen.
 *
 *   - `animation: 'none'` — the screen swaps on the frame the tab is tapped; the tab bar's own
 *     highlight is what animates. A 180ms cross-fade was tried and measured on the device: for those
 *     frames both screens were half-visible, and Android draws the elevation shadows of a fading
 *     screen as grey boxes — the Profile cards "blinked" through Rides on every switch. Tabs are
 *     peers, and the large apps switch them instantly for the same reason.
 *   - `freezeOnBlur` — a tab that is not on screen stops re-rendering. The home screen keeps a map,
 *     a location watch and live booking queries; without this they kept re-rendering behind Rides
 *     and Profile, competing with the screen actually being used.
 */
const TAB_SCREEN_OPTIONS: BottomTabNavigationOptions = {
  headerShown: false,
  animation: 'none',
  freezeOnBlur: true,
};

/**
 * The signed-in shell.
 *
 * A route GROUP — the parentheses keep `(tabs)` out of the URL, so the booking screen stays at
 * `/home` exactly as before and the four `router.replace('/home')` calls in the auth flow did not
 * have to change.
 *
 * **Three tabs, not five.** The customer app's surface today is booking, the trips that come out
 * of it, and the account. A tab per future feature would be a bar of dead ends, and the roadmap
 * (docs/LLD/roadmap.md phase 7) adds tracking and receipts INSIDE the trip flow rather than
 * beside it.
 */
export default function TabsLayout(): ReactElement {
  const queryClient = useQueryClient();

  /*
   * Ride history is fetched as soon as the signed-in shell opens, not when the Rides tab is first
   * tapped. The tabs mount lazily, so without this the first visit after every app start showed a
   * spinner over an empty list for however long the request took. Same key and fetcher as the
   * screen, so the screen finds it in the cache; a request already in flight is simply joined.
   * Only the FIRST page of the unfiltered view — what the screen opens on.
   */
  useEffect(() => {
    void queryClient.prefetchInfiniteQuery(rideHistoryQuery(DEFAULT_HISTORY_VIEW));
  }, [queryClient]);

  /*
   * THE OTHER TABS ARE BUILT BEFORE THEY ARE TAPPED. Tabs mount lazily, so the first visit to
   * Rides built its whole screen at tap time — on the device that was a held-up tab switch.
   * `prefetch` renders the screen in the background instead, once the home screen has finished
   * its own start-up work, so the first tap only has to reveal it.
   */
  useEffect(() => {
    // `requestIdleCallback`, not `InteractionManager` — deprecated in this React Native version.
    let idle: number | null = null;
    const timer = setTimeout(() => {
      idle = requestIdleCallback(() => {
        router.prefetch('/rides');
        router.prefetch('/account');
      });
    }, PRELOAD_DELAY_MS);
    return () => {
      clearTimeout(timer);
      if (idle !== null) cancelIdleCallback(idle);
    };
  }, []);

  return (
    <Tabs
      // `tabBar` replaces the stock bar entirely — colours, spacing and the selected state all
      // live in `TabBar`, which is why no `tabBar*` style option is set here any more. The icons
      // below are still read from these options: `TabBar` calls each `tabBarIcon` twice, once per
      // `focused` value, and cross-fades the two.
      //
      // Icons are drawn from whichever @expo/vector-icons set has the right glyph for the tab —
      // not one set throughout — in filled/outline pairs where the set has one. The PAIR is the
      // point: an active tab that differs only in colour is one grey against one black in this
      // palette, which is not enough at a glance. A solid glyph reads as selected across the
      // room, which is a tab bar's whole job. Every name below was checked against its set's
      // shipped glyph map — a missing one renders as a blank box, silently.
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={TAB_SCREEN_OPTIONS}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          /*
           * NOT FROZEN, unlike the other tabs. Frozen, every update Home missed while hidden (map,
           * location, live booking) was rendered in one go the moment it came back — a single
           * ~150ms frame on every return to Home, measured on the device. Kept live, it absorbs
           * those updates as they happen and returns with nothing to catch up on.
           */
          freezeOnBlur: false,
          tabBarIcon: ({ color, size, focused }) => (
            <Octicons name={focused ? 'home-fill' : 'home'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="rides"
        options={{
          title: 'Rides',
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons name={focused ? 'map' : 'map-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Profile',
          // FontAwesome5's free tier ships `user-alt` in the solid style only — there is no
          // regular-weight counterpart to cross-fade into, so this stays one fixed glyph, same as
          // every icon here that has no outline/filled pair.
          tabBarIcon: ({ color, size }) => (
            <FontAwesome5 name="user-alt" solid size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
