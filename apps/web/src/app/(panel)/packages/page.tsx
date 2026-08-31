import { PackagesScreen } from '@/features/packages/components/PackagesScreen';

/**
 * No Suspense boundary here, unlike `/customers`. The InCity/Outstation toggle is React state,
 * not a URL filter, so this screen never calls `useSearchParams` and Next has no reason to opt
 * the route out of static prerendering. The editors have their own routes; a tab is not a view
 * worth deep-linking.
 */
export default function PackagesPage() {
  return <PackagesScreen />;
}
