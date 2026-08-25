'use client';

import { cn } from './cn';

/**
 * A background refetch is NOT a loading state. Replacing rows that are already on screen with
 * skeletons every thirty seconds makes the row an admin is reading vanish underneath them.
 *
 * This is what a refetch gets instead: 2px, at the top of the content region, and nothing else.
 */
export function TopProgressBar({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        'h-0.5 w-full overflow-hidden transition-opacity duration-200',
        active ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div className="h-full w-1/3 bg-interactive animate-[indeterminate_1.2s_ease-in-out_infinite]" />
    </div>
  );
}
