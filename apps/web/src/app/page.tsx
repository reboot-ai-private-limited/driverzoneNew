import { redirect } from 'next/navigation';
import { LANDING_PATH } from '@/lib/auth/next-path';

/**
 * `/` is not a screen, it is a pointer at whichever one is the landing screen today — the same
 * pointer login and the 404 page follow. See `LANDING_PATH`, which is where that decision
 * lives; when the dashboard in docs/LLD/admin-panel.md exists, this file does not change.
 */
export default function Home() {
  redirect(LANDING_PATH);
}
