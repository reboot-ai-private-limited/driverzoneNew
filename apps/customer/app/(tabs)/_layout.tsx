import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ReactElement } from 'react';
import { colors, fontFamily, radius, text } from '@/theme/theme';

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
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.fg,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
          height: 60,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: { ...text.caption, fontWeight: '600', fontFamily: fontFamily.semibold },
        // MaterialCommunityIcons, in filled/outline pairs.
        //
        // The PAIR is the point: an active tab that differs only in colour is one grey against
        // one black in this palette, which is not enough at a glance. A solid glyph reads as
        // selected across the room, which is a tab bar's whole job. Every name below was checked
        // against the shipped glyph map — a missing one renders as a blank box, silently.
        tabBarItemStyle: { borderRadius: radius.sm },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Book',
          // A steering wheel, not a map pin or a car. DriverZone sends a DRIVER to a customer's
          // own vehicle (docs/LLD/open-questions.md Q5) — a car icon would promise the wrong
          // product, and a pin describes the map rather than the thing being booked. One fixed
          // glyph rather than a pair: "steering" has no filled counterpart in the shipped set,
          // and a control that renders blank on the active tab is worse than one that never
          // changes.
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="steering" size={size + 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="rides"
        options={{
          title: 'Rides',
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'clipboard-text-clock' : 'clipboard-text-clock-outline'}
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
