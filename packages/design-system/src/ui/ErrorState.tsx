'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './Button';
import { RequestId } from './RequestId';

export interface ErrorStateProps {
  /**
   * The SERVER'S message, rendered verbatim. Never assembled from an error code — a reason
   * added server-side then renders correctly on a client that predates it, and the API
   * guarantees this string is safe to display (docs/engineering/coding-standards.md).
   */
  message: string;
  requestId?: string;
  /**
   * Omit for anything a retry cannot fix — FORBIDDEN above all. A retry button on a
   * permissions error invites the user to click it four times and conclude the tool is broken.
   */
  onRetry?: () => void;
  title?: string;
}

export function ErrorState({ message, requestId, onRetry, title }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center text-center gap-2 py-10 px-4"
    >
      <AlertTriangle aria-hidden className="size-6 text-danger" />
      {title !== undefined && <p className="text-sm font-medium text-text">{title}</p>}
      <p className="text-sm text-text max-w-md">{message}</p>
      {requestId !== undefined && <RequestId id={requestId} />}
      {onRetry !== undefined && (
        <Button size="sm" onClick={onRetry} icon={<RefreshCw aria-hidden className="size-3.5" />}>
          Try again
        </Button>
      )}
    </div>
  );
}
