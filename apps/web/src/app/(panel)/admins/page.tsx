import { AdminsScreen } from '@/features/admins/components/AdminsScreen';

/**
 * No Suspense boundary needed, unlike the directories: this screen reads nothing from the URL, so
 * Next can prerender its shell. The roster itself loads client-side like every other screen.
 */
export default function AdminsPage() {
  return <AdminsScreen />;
}
