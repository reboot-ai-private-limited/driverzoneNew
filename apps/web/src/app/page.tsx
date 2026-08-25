import { redirect } from 'next/navigation';

/**
 * Zones is the only screen with a working API today, so it is the landing page. When the
 * dashboard in docs/LLD/admin-panel.md exists this redirect goes away.
 */
export default function Home() {
  redirect('/zones');
}
