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
 * **Three tabs, and Earnings is here even though the endpoint is not.** `GET /driver/earnings`
 * arrives in Phase 8; the tab ships now with an honest empty state rather than appearing later
 * and moving everything else along by one. A driver learns a bar's shape in the first week.
 *
 * The ringing offer and the trip screens are deliberately NOT tabs — they are full-screen routes
 * outside this group (docs/LLD/driver-app.md S-5). A trip offer that shows a tab bar invites the
 * driver to navigate away from the one thing that is time-limited.
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
