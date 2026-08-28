'use client';

import { useSyncExternalStore } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { cn } from './cn';
import { RequestId } from './RequestId';

/**
 * Toasts, and only for mutations.
 *
 * A read never toasts (docs/engineering/frontend-architecture.md §7): a failed read renders an
 * error state where the data would have been, and a notification about something the user is
 * already staring at is noise. A write is the opposite case — the confirmation is the only
 * evidence anything happened, and it has to be visible from wherever the admin's eyes went next.
 *
 * The store is module-level rather than a context because the caller is `useApiMutation`, which
 * runs inside a mutation callback where hooks are not available. `<Toaster>` subscribes to it.
 */

export type ToastTone = 'success' | 'danger';

export interface ToastRecord {
  id: number;
  tone: ToastTone;
  /**
   * The SERVER'S message on a failure, verbatim. Never assembled from a fault code — see
   * docs/engineering/coding-standards.md §Two rules the client owes the API.
   */
  message: string;
  /** Present on failures, so an ops person can quote it without reproducing the error. */
  requestId?: string | undefined;
}

/** Long enough to read a sentence. Failures do not auto-dismiss at all — see `Toaster` below. */
const SUCCESS_DURATION_MS = 4000;

let nextId = 1;
let toasts: readonly ToastRecord[] = [];
const listeners = new Set<() => void>();

function emit(next: readonly ToastRecord[]): void {
  toasts = next;
  for (const listener of listeners) listener();
}

function push(tone: ToastTone, message: string, requestId?: string): void {
  emit([...toasts, { id: nextId++, tone, message, requestId }]);
}

export const toast = {
  success: (message: string): void => push('success', message),
  /** `requestId` comes off `ApiError`; pass it whenever there is one. */
  error: (message: string, requestId?: string): void => push('danger', message, requestId),
};

function dismiss(id: number): void {
  emit(toasts.filter((record) => record.id !== id));
}

const TONES: Record<ToastTone, { ring: string; icon: string }> = {
  success: { ring: 'border-success/30', icon: 'text-success' },
  danger: { ring: 'border-danger/30', icon: 'text-danger' },
};

/**
 * Mount once, at the app root. Renders whatever is in the store.
 *
 * A failure has no auto-dismiss (`duration: Infinity`). A success is an acknowledgement and can
 * expire on its own; a failure is the only place the server's explanation exists, and expiring
 * it after four seconds means an admin who looked away has lost the reason their change did not
 * save — along with the request id support would have asked for.
 */
export function Toaster() {
  const records = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => toasts,
    // Server snapshot. The panel is a client application, but Next still renders the shell once
    // and a differing snapshot would hydrate-mismatch.
    () => EMPTY,
  );

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {records.map((record) => (
        <ToastPrimitive.Root
          key={record.id}
          duration={record.tone === 'success' ? SUCCESS_DURATION_MS : Infinity}
          onOpenChange={(open) => {
            if (!open) dismiss(record.id);
          }}
          className={cn(
            'flex items-start gap-2.5 p-3 pr-9 relative',
            'bg-surface border rounded-md shadow-lg',
            'data-[state=closed]:opacity-0 transition-opacity',
            TONES[record.tone].ring,
          )}
        >
          {record.tone === 'success' ? (
            <CheckCircle2
              aria-hidden
              className={cn('size-4 mt-0.5 shrink-0', TONES.success.icon)}
            />
          ) : (
            <AlertTriangle
              aria-hidden
              className={cn('size-4 mt-0.5 shrink-0', TONES.danger.icon)}
            />
          )}

          <div className="flex flex-col gap-1.5 min-w-0">
            <ToastPrimitive.Description className="text-sm text-text">
              {record.message}
            </ToastPrimitive.Description>
            {record.requestId !== undefined && <RequestId id={record.requestId} />}
          </div>

          <ToastPrimitive.Close
            aria-label="Dismiss"
            className="absolute top-2 right-2 p-1 rounded-sm text-text-subtle hover:text-text"
          >
            <X aria-hidden className="size-3.5" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}

      <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)] outline-none" />
    </ToastPrimitive.Provider>
  );
}

/** A stable empty array — returning a new `[]` from the server snapshot loops the store. */
const EMPTY: readonly ToastRecord[] = [];
