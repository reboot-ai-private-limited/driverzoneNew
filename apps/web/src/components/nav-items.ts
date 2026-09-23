import {
  Building2,
  CalendarClock,
  Coins,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Settings,
  ShieldCheck,
  Users,
  UserCog,
  Star,
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
  /**
   * Shown only to a SUPER_ADMIN. Hiding is a courtesy, not the guard: the server refuses these
   * routes to anyone else, so a hidden item an admin reaches by URL renders its 403 error state.
   */
  superAdminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  // Enabled: the screen is built. Every tile reads an endpoint that already exists — the admin
  // booking, driver, review and finance lists all return a total for the filter they were given,
  // so the counts needed no `/dashboard/summary` of their own.
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  // Enabled: the screen is built and `GET /admin/bookings` exists in `apps/api`, alongside the
  // single-booking read and the event timeline the detail view uses.
  { label: 'Bookings', href: '/bookings', icon: CalendarClock },
  { label: 'Drivers', href: '/drivers', icon: Users },
  // Enabled: the screen is built. Its API (`GET/PATCH /admin/customers`) is not in `apps/api`
  // yet, so it renders its error state until those routes exist — see
  // `lib/api/endpoints/customers.ts`. Left disabled it would be unreachable to test against.
  { label: 'Customers', href: '/customers', icon: UserCog },
  // Enabled: the screen is built and `GET/POST/PUT /admin/packages/{incity,outstation}` all
  // exist in `apps/api`. It is the editor the zones screen's city card links out to.
  { label: 'Packages', href: '/packages', icon: Package },
  { label: 'Zones', href: '/zones', icon: Building2 },
  { label: 'Reviews', href: '/reviews', icon: Star },
  // Enabled: all three tabs are built and `GET /admin/finance/{driver-balances,transactions,
  // customer-wallets}` exist in `apps/api` (the tier-8 `admin` module), as does the settlement
  // POST. Payout batching is a separate project and is deliberately not behind this item.
  { label: 'Finance', href: '/finance', icon: Coins },
  // Enabled: the screen is built and `GET/PATCH /admin/settings` exists in `apps/api`.
  { label: 'Settings', href: '/settings', icon: Settings },
  // SUPER_ADMIN only: who can sign in to this panel. `GET/POST/PATCH /admin/admins`.
  { label: 'Admins', href: '/admins', icon: ShieldCheck, superAdminOnly: true },
];
