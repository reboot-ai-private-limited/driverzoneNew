import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SkeletonFieldList } from '@driverzone/design-system';
import { OutstationEditor } from '@/features/packages/components/OutstationEditor';

export const metadata: Metadata = {
  title: 'Outstation Band',
};

/**
 * The boundary is required even here. `OutstationEditor` is shared with `/new` and calls
 * `useSearchParams` unconditionally to read a pre-filled band — Next opts any route whose tree
 * reads search params out of static prerendering, and the build fails without a boundary.
 */
export default function OutstationBandPage() {
  return (
    <Suspense fallback={<SkeletonFieldList rows={6} />}>
      <OutstationEditor />
    </Suspense>
  );
}
