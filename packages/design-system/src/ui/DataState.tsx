'use client';

import type { ReactNode } from 'react';
import { EmptyState, type EmptyStateProps } from './EmptyState';
import { ErrorState, type ErrorStateProps } from './ErrorState';

export interface DataStateProps {
  /** True only on the FIRST load. A background refetch is not a loading state. */
  loading: boolean;
  error?: ErrorStateProps | undefined;
  empty?: boolean;
  emptyState?: EmptyStateProps;
  /** The skeleton for this surface — real geometry, not a spinner. */
  skeleton: ReactNode;
  children: ReactNode;
}

/**
 * Every data surface is in exactly one of four states: loading, error, empty, ready.
 *
 * This wrapper exists so a screen that handles only three of them is visible in a diff. The
 * rule on its own is a convention, and conventions decay; a component whose props do not
 * type-check without an empty state does not.
 *
 * Order matters. Error beats empty — a failed request has no rows either, and rendering
 * "nothing here yet" for a 500 tells the user something false.
 */
export function DataState({
  loading,
  error,
  empty,
  emptyState,
  skeleton,
  children,
}: DataStateProps) {
  if (loading) return <>{skeleton}</>;
  if (error !== undefined) return <ErrorState {...error} />;
  if (empty === true && emptyState !== undefined) return <EmptyState {...emptyState} />;
  return <>{children}</>;
}
