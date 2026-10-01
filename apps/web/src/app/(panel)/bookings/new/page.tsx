import type { Metadata } from 'next';
import { NewBookingScreen } from '@/features/bookings/components/NewBookingScreen';

export const metadata: Metadata = {
  title: 'New Booking',
};

/**
 * A static segment, so it wins over the sibling `[id]` route — `/bookings/new` is never read as a
 * booking id. No Suspense boundary: the screen reads nothing from `useSearchParams`.
 */
export default function NewBookingPage() {
  return <NewBookingScreen />;
}
