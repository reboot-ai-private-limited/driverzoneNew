import type { Metadata } from 'next';
import { DriversScreen } from '@/features/drivers/components/DriversScreen';

export const metadata: Metadata = {
  title: 'Drivers',
};

export default function DriversPage() {
  return <DriversScreen />;
}
