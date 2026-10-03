import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs, router } from 'expo-router';
import type { BottomTabNavigationOptions } from 'expo-router/build/react-navigation/bottom-tabs';
import { type ReactElement, useEffect } from 'react';
import { TabBar } from '@/components/TabBar';
import { DEFAULT_TRIPS_VIEW, tripHistoryQuery } from '@/features/trips/historyQuery';

/** How long after the duty screen settles before the other tabs are built in the background. */
const PRELOAD_DELAY_MS = 1200;

/**
 * Every tab switch: INSTANT and SILENT, with hidden tabs frozen.
 *
 *   - `animation: 'none'` — the screen swaps on the frame the tab is tapped; the tab bar's own
 *     highlight is what animates. A cross-fade leaves both screens half-visible, and Android draws
 *     the elevation shadows of a fading screen as grey boxes. Tabs are peers; switching them
 *     instantly is what the large apps do.
 *   - `freezeOnBlur` — a tab that is not on screen stops re-rendering, so the lists behind the
 *     one in use are not competing with it.
 *   - Silent: the tab bar plays no haptic tick — see `TabBar`.
 */
const TAB_SCREEN_OPTIONS: BottomTabNavigationOptions = {
  headerShown: false,
  animation: 'none',
  freezeOnBlur: true,
};

/**
 * The approved-driver shell.
 *
 * A route GROUP — the parentheses keep `(tabs)` out of the URL, so the duty screen stays at
 * `/home` and `/gate` can route to it by that name.
 *
 * **Four tabs: Duty, Trips, Earnings, Account.** Trips and Earnings sit side by side because they
 * answer two different questions off two different sources — "what did I drive?" reads the
 * bookings, "what am I owed?" reads the ledger — and a driver checking a payout against a shift
 * needs both without either pretending to be the other.
 *
 * The ringing offer and the LIVE trip screen are deliberately NOT tabs — they are full-screen
 * routes outside this group (docs/LLD/driver-app.md S-5). A trip offer that shows a tab bar
 * invites the driver to navigate away from the one thing that is time-limited. `/trips/[id]`, the
 * read-only receipt, is a plain route outside the group too: it is pushed from this tab and comes
 * back to it.
 */
export default function TabsLayout(): ReactElement {
  const queryClient = useQueryClient();

  /*
   * The first page of the Trips list is fetched as soon as the shell mounts, so it is in the cache
   * before the tab is tapped. Same key and fetcher as the screen, so the screen finds it; a request
   * already in flight is simply joined.
   */
  useEffect(() => {
    void queryClient.prefetchInfiniteQuery(tripHistoryQuery(DEFAULT_TRIPS_VIEW));
  }, [queryClient]);

  /*
   * THE OTHER TABS ARE BUILT BEFORE THEY ARE TAPPED. Tabs mount lazily, so the first visit to a tab
   * built its whole screen at tap time — a held-up switch. `prefetch` renders the screen in the
   * background once the duty screen has finished its own start-up work.
   */
  useEffect(() => {
    let idle: number | null = null;
    const timer = setTimeout(() => {
      idle = requestIdleCallback(() => {
        router.prefetch('/trips');
        router.prefetch('/earnings');
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
      // `tabBar` replaces the stock bar entirely — the same component the customer app uses, so
      // colours, spacing and the selected state all live in `TabBar` and no `tabBar*` style
      // option is set here any more. The icons below are still read from these options: `TabBar`
      // calls each `tabBarIcon` twice, once per `focused` value, and cross-fades the two.
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={TAB_SCREEN_OPTIONS}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Duty',
          // NOT FROZEN: the duty screen keeps live queries and a location watch, and frozen it would
          // render everything it missed in one frame on every return.
          freezeOnBlur: false,
          // A steering wheel rather than a car: DriverZone sends a driver to the customer's own
          // vehicle (docs/LLD/open-questions.md Q5), and a car icon would promise the wrong
          // product. One fixed glyph rather than a filled/outline pair — "steering" has no filled
          // counterpart in the shipped set, and a tab that renders blank when active is worse
          // than one that never changes.
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="steering" size={size + 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          // A receipt-shaped glyph rather than a car: this tab is the RECORD of work done, and
          // the steering wheel next door already stands for the driving itself.
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'clipboard-text' : 'clipboard-text-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'wallet' : 'wallet-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'account-circle' : 'account-circle-outline'}
              size={size + 2}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
