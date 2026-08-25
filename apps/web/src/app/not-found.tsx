import Link from 'next/link';
import { Button, EmptyState } from '@driverzone/design-system';

export default function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center bg-surface-sunken p-4">
      <EmptyState
        title="No such screen"
        description="That URL does not match anything in the admin panel."
        action={
          <Link href="/zones">
            <Button variant="primary" size="sm">
              Go to Zones
            </Button>
          </Link>
        }
      />
    </div>
  );
}
