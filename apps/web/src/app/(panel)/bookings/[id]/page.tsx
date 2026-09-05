import type { Metadata } from 'next';
import { BookingDetailsScreen } from '@/features/bookings/components/BookingDetailsScreen';

export const metadata: Metadata = {
  title: 'Booking Details',
};

/**
 * No Suspense boundary here, unlike `/bookings`. This screen reads its id from `useParams`, not
 * `useSearchParams`, and only the latter opts a route out of static prerendering — the same
 * reasoning `/customers/[id]/page.tsx` records.
 */
export default function BookingDetailsPage() {
  return <BookingDetailsScreen />;
}
