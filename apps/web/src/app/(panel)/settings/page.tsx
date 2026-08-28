import { SettingsScreen } from '@/features/settings/components/SettingsScreen';

/**
 * No Suspense boundary here, unlike `/zones` and `/customers`: this screen keeps its state in
 * React rather than in the URL, so it never calls `useSearchParams` and Next has no reason to opt
 * the route out of static prerendering.
 *
 * The form is deliberately not URL-addressable. A half-edited settings page is not a view worth
 * sharing or bookmarking, and putting draft values in the query string would put unsaved fare
 * changes in browser history.
 */
export default function SettingsPage() {
  return <SettingsScreen />;
}
