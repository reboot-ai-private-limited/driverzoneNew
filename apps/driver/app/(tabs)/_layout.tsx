import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ReactElement } from 'react';
import { TabBar } from '@/components/TabBar';

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
  return (
    <Tabs
      // `tabBar` replaces the stock bar entirely — the same component the customer app uses, so
      // colours, spacing and the selected state all live in `TabBar` and no `tabBar*` style
      // option is set here any more. The icons below are still read from these options: `TabBar`
      // calls each `tabBarIcon` twice, once per `focused` value, and cross-fades the two.
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Duty',
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
