import type { Metadata } from 'next';
import { IncityEditor } from '@/features/packages/components/IncityEditor';

export const metadata: Metadata = {
  title: 'New InCity Package',
};

/**
 * The same component as `[id]`. `useParams().id` is absent here, and that absence IS the
 * create/edit distinction — there is no second form to keep in step with the first.
 */
export default function NewIncityPackagePage() {
  return <IncityEditor />;
}
