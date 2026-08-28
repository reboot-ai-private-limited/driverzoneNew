import type { Metadata } from 'next';
import { CustomerDetailScreen } from '@/features/customers/components/CustomerDetailScreen';

export const metadata: Metadata = {
  title: 'Customer Details',
};

/**
 * No Suspense boundary here, unlike `/customers`. This screen reads its id from `useParams`,
 * not `useSearchParams`, and only the latter opts a route out of static prerendering.
 */
export default function CustomerDetailsPage() {
  return <CustomerDetailScreen />;
}
