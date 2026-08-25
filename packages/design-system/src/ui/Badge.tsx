'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Tinted background with a full-strength ink of the same hue. No shadow, no heavy border —
 * a row of these should read as labels, not as buttons the user failed to click.
 *
 * The accent tone uses the lime FILL with dark ink, which is the only way it can be used.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-text-subtle',
  accent: 'bg-accent text-accent-ink',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-interactive/10 text-interactive',
};

export interface BadgeProps {
  tone?: BadgeTone;
  icon?: ReactNode;
  /** Explicitly `| undefined`: apps/api-style `exactOptionalPropertyTypes` is on repo-wide,
   * under which `?: string` forbids passing `{ className: undefined }` through. */
  className?: string | undefined;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * The domain statuses that appear across more than one screen, mapped to a tone once.
 *
 * Colour is never the only signal — the label is always rendered — so this stays legible to
 * someone who cannot distinguish the tones.
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  VERIFIED: 'success',
  PENDING: 'warning',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
  FREE: 'success',
  PAID: 'warning',
  CITY: 'info',
  PICKUP: 'accent',
  HILL: 'neutral',
};

export function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string | undefined;
}) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'} className={className}>
      {status}
    </Badge>
  );
}
