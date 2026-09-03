import { FontAwesome5, MaterialCommunityIcons, Octicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ReactElement } from 'react';
import { TabBar } from '@/components/TabBar';

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
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
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
