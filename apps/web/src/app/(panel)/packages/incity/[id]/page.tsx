import type { Metadata } from 'next';
import { IncityEditor } from '@/features/packages/components/IncityEditor';

export const metadata: Metadata = {
  title: 'InCity Package',
};

/**
 * No Suspense boundary: this screen reads its id from `useParams`, not `useSearchParams`, and
 * only the latter opts a route out of static prerendering.
 */
export default function IncityPackagePage() {
  return <IncityEditor />;
}
