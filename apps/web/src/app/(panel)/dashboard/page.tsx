import { DashboardScreen } from '@/features/dashboard/components/DashboardScreen';

/**
 * The landing screen. `LANDING_PATH` points here, so login, the 404 and `/` all arrive on it.
 *
 * No `Suspense` boundary, unlike the finance and bookings pages: nothing on this screen reads
 * `useSearchParams`. It has no filters — the tiles are fixed questions, and the answer to each
 * one is a link out to the screen that does have filters. Add the boundary if that ever changes,
 * or the build will fail on this page rather than degrade.
 */
export default function DashboardPage() {
  return <DashboardScreen />;
}
