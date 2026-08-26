'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full px-2 rounded-md bg-surface text-text text-sm',
        // border-strong, not border: a control boundary carries meaning and needs 3:1
        // (WCAG 1.4.11). The hairline used between table rows is far too light here.
        'border border-border-strong placeholder:text-text-subtle',
        'focus-visible:outline-2 focus-visible:outline-interactive focus-visible:outline-offset-0',
        'disabled:bg-surface-muted disabled:text-text-subtle',
        invalid === true && 'border-danger',
        className,
      )}
      {...rest}
    />
  );
});

export interface FormFieldProps {
  label: string;
  /** Rendered under the control. Replaced by `error` when there is one. */
  hint?: string | undefined;
  /**
   * Field-level message, normally from an ApiError's `data` on VALIDATION_FAILED.
   * Rendered verbatim — the server's wording, not ours.
   *
   * Explicitly `| undefined`: `exactOptionalPropertyTypes` is on repo-wide, under which
   * `?: string` forbids passing `{ error: undefined }` through from a `useState<string | undefined>`.
   */
  error?: string | undefined;
  required?: boolean | undefined;
  children: (props: { id: string; invalid: boolean; describedBy: string | undefined }) => ReactNode;
}

/**
 * Label, control, and one message slot — wired together by id so the message is announced
 * with the field rather than read as loose text somewhere on the page.
 *
 * Takes a render prop rather than cloning its child: cloning silently drops the wiring the
 * moment someone wraps the input in a div, and the failure is invisible until it is tested
 * with a screen reader.
 */
export function FormField({ label, hint, error, required, children }: FormFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-text">
        {label}
        {required === true && (
          <span aria-hidden className="text-danger ml-0.5">
            *
          </span>
        )}
      </label>
      {children({
        id,
        invalid: error !== undefined,
        describedBy: message === undefined ? undefined : messageId,
      })}
      {message !== undefined && (
        <p
          id={messageId}
          role={error === undefined ? undefined : 'alert'}
          className={cn('text-xs', error === undefined ? 'text-text-subtle' : 'text-danger')}
        >
          {message}
        </p>
      )}
    </div>
  );
}
