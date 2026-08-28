import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SkeletonFieldList } from '@driverzone/design-system';
import { OutstationEditor } from '@/features/packages/components/OutstationEditor';

export const metadata: Metadata = {
  title: 'New Outstation Band',
};

/**
 * The boundary is not optional: this route is reached from a coverage gap with
 * `?terrain=HILL&minKm=100`, which `OutstationEditor` reads via `useSearchParams`. Without a
 * Suspense boundary the build fails on this page.
 */
export default function NewOutstationBandPage() {
  return (
    <Suspense fallback={<SkeletonFieldList rows={6} />}>
      <OutstationEditor />
    </Suspense>
  );
}
