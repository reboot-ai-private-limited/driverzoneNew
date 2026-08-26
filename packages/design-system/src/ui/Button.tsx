'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * `primary` is the accent FILL with dark ink on it — never white text. #c0ff72 is 1.18:1
 * against white, so a white label on it is unreadable. See docs/engineering/design-language.md.
 *
 * No shadows on any variant. Depth comes from the border and the surface.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface text-text border border-border-strong hover:bg-surface-muted',
  ghost: 'bg-transparent text-text border border-transparent hover:bg-surface-muted',
  danger: 'bg-danger text-surface border border-transparent hover:brightness-95',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2 gap-1.5 text-xs rounded-sm',
  md: 'h-10 px-4 gap-2 text-sm rounded-md',
  lg: 'h-12 px-6 gap-2 text-md rounded-md',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks clicks. The label stays — see the note below. */
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // `disabled` alone would let a double-click through between the click and the state
      // update; `aria-busy` is what a screen reader announces.
      disabled={rest.disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap',
        'transition-colors disabled:opacity-50 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {/*
        The label stays visible while loading, and the spinner replaces only the icon slot.
        Swapping the label for a spinner changes the button's width, which makes the whole
        row jump at the moment the user is watching it.
      */}
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children'> {
  icon: ReactNode;
  /** Required: an icon-only control with no accessible name is invisible to a screen reader. */
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', className, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      size={size}
      aria-label={label}
      className={cn(
        'px-0 aspect-square',
        size === 'sm' ? 'w-8' : size === 'lg' ? 'w-12' : 'w-10',
        className,
      )}
      icon={icon}
      {...rest}
    />
  );
});
