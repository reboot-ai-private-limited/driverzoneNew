import Link from 'next/link';
import { Button, EmptyState } from '@driverzone/design-system';
import { LANDING_PATH } from '@/lib/auth/next-path';

/**
 * Rendered outside both session gates — it sits at the app root, so an unmatched URL never
 * needs a session to answer. An anonymous visitor who takes the link lands on the panel gate
 * and is sent to /login from there, which is the same route any other panel URL would take.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center bg-surface-sunken p-4">
      <EmptyState
        title="No such screen"
        description="That URL does not match anything in the admin panel."
        action={
          <Link href={LANDING_PATH}>
            <Button variant="primary" size="sm">
              Back to the panel
            </Button>
          </Link>
        }
      />
    </div>
  );
}
