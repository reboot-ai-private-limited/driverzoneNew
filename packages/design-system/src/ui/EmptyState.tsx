'use client';

import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  /** What this is and, where there is one, the action that fills it. */
  description?: string;
  action?: ReactNode;
}

/**
 * Empty is a real state, not a table with no rows. A grid of column headers over nothing tells
 * the user the screen is broken; this tells them it is working and there is nothing here yet.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-10 px-4">
      {icon !== undefined && <div className="text-text-subtle">{icon}</div>}
      <p className="text-sm font-medium text-text">{title}</p>
      {description !== undefined && (
        <p className="text-xs text-text-subtle max-w-sm">{description}</p>
      )}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}
