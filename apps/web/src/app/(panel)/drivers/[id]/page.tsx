import type { Metadata } from 'next';
import { DriverDetailsScreen } from '@/features/drivers/components/DriverDetailsScreen';

export const metadata: Metadata = {
  title: 'Driver Details',
};

export default function DriverDetailsPage() {
  return <DriverDetailsScreen />;
}
