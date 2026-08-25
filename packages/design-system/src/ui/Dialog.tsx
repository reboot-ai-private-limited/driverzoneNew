'use client';

import type { ReactNode } from 'react';
import * as Radix from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button, type ButtonVariant } from './Button';
import { cn } from './cn';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * A modal. Radix owns the focus trap, the escape key, the scroll lock and the ARIA wiring —
 * the parts that are genuinely hard and that a hand-rolled dialog gets wrong in ways only a
 * keyboard user notices.
 *
 * No shadow: the scrim is what separates it from the page, plus a border-strong edge.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-50 bg-text/30" />
        <Radix.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
            'bg-surface border border-border-strong rounded-md',
            className,
          )}
        >
          <header className="flex items-start justify-between gap-4 px-4 py-2 border-b border-border">
            <div className="flex flex-col gap-1">
              <Radix.Title className="text-sm font-semibold text-text">{title}</Radix.Title>
              {description !== undefined && (
                <Radix.Description className="text-xs text-text-subtle">
                  {description}
                </Radix.Description>
              )}
            </div>
            <Radix.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="text-text-subtle hover:text-text p-1 -m-1 rounded-sm"
              >
                <X aria-hidden className="size-4" />
              </button>
            </Radix.Close>
          </header>

          {children !== undefined && <div className="px-4 py-4">{children}</div>}

          {footer !== undefined && (
            <footer className="flex items-center justify-end gap-2 px-4 py-2 border-t border-border">
              {footer}
            </footer>
          )}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /**
   * The BLAST RADIUS, not a message. One line per consequence.
   *
   * Structured rather than a string because that is what the zone deactivation flow needs:
   * "removes pickup coverage for ~34% of Siliguri", "leaves 8 scheduled bookings without
   * coverage" (docs/LLD/admin-panel.md). Blocking outright is wrong — sometimes you genuinely
   * must pull a zone — and so is a bare "Are you sure?". Show the damage, let a human decide.
   */
  consequences?: ReactNode[];
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
  variant?: Extract<ButtonVariant, 'primary' | 'danger'>;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequences,
  confirmLabel,
  onConfirm,
  loading,
  variant = 'danger',
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button size="sm" onClick={() => onOpenChange(false)} disabled={loading === true}>
            Cancel
          </Button>
          <Button size="sm" variant={variant} onClick={onConfirm} loading={loading === true}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {consequences !== undefined && consequences.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm text-text">
          {consequences.map((c, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={i} className="flex gap-2">
              <span aria-hidden className="text-text-subtle">
                •
              </span>
              {c}
            </li>
          ))}
        </ul>
      )}
      {children}
    </Dialog>
  );
}
