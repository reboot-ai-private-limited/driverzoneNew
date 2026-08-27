import {
  BarChart3,
  Building2,
  CalendarClock,
  Coins,
  LayoutDashboard,
  type LucideIcon,
  Map,
  Package,
  ScrollText,
  Settings,
  Users,
  UserCog,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Screens whose API does not exist yet render DISABLED with a tooltip, not hidden.
   *
   * Ops should be able to see the shape of the product they are being given, and a nav that
   * silently grows week to week is harder to trust than one that shows what is coming. The
   * order is the screen list in docs/LLD/admin-panel.md.
   */
  comingSoon?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard, comingSoon: true },
  { label: 'Bookings', href: '/bookings', icon: CalendarClock, comingSoon: true },
  { label: 'Dispatch', href: '/dispatch', icon: Map, comingSoon: true },
  { label: 'Drivers', href: '/drivers', icon: Users, comingSoon: true },
  // Enabled: the screen is built. Its API (`GET/PATCH /admin/customers`) is not in `apps/api`
  // yet, so it renders its error state until those routes exist — see
  // `lib/api/endpoints/customers.ts`. Left disabled it would be unreachable to test against.
  { label: 'Customers', href: '/customers', icon: UserCog },
  { label: 'Packages', href: '/packages', icon: Package, comingSoon: true },
  { label: 'Zones', href: '/zones', icon: Building2 },
  { label: 'Finance', href: '/finance', icon: Coins, comingSoon: true },
  { label: 'Reports', href: '/reports', icon: BarChart3, comingSoon: true },
  { label: 'Audit Log', href: '/audit', icon: ScrollText, comingSoon: true },
  { label: 'Settings', href: '/settings', icon: Settings, comingSoon: true },
];
