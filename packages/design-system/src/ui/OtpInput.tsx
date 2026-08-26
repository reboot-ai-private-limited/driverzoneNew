'use client';

import { useRef, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from './cn';

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  /** Focus the first box on mount — the OTP step has exactly one thing to do. */
  autoFocus?: boolean;
}

/**
 * The login OTP is 6 digits (docs/LLD/auth.md). One box per digit.
 *
 * `inputMode="numeric"` and `autocomplete="one-time-code"` are what make a phone offer the
 * SMS code from the notification, which is the difference between tapping once and switching
 * apps to read a number. Paste is handled explicitly because a pasted 6-digit string would
 * otherwise land entirely in the first box.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled,
  invalid,
  autoFocus,
}: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const setAt = (index: number, digit: string): void => {
    const next = digits.map((d, i) => (i === index ? digit : d)).join('');
    onChange(next.replace(/\D/g, '').slice(0, length));
  };

  const handleChange = (index: number) => (e: ChangeEvent<HTMLInputElement>) => {
    const digit = e.target.value.replace(/\D/g, '').slice(-1);
    if (digit === '') return;
    setAt(index, digit);
    refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && digits[index] === '') {
      // Stepping back on an empty box is what makes backspace feel like one field rather
      // than six — otherwise the caret sits in a box that is already empty and nothing moves.
      e.preventDefault();
      refs.current[index - 1]?.focus();
      setAt(index - 1, '');
    }
    if (e.key === 'ArrowLeft') refs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight') refs.current[index + 1]?.focus();
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (pasted === '') return;
    onChange(pasted);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  };

  return (
    <div className="flex gap-2" role="group" aria-label={`${length}-digit code`}>
      {digits.map((digit, i) => (
        <input
          // Index is the identity here: these boxes are positional and never reorder.
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digit}
          onChange={handleChange(i)}
          onKeyDown={handleKeyDown(i)}
          onPaste={handlePaste}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-label={`Digit ${i + 1}`}
          autoFocus={autoFocus === true && i === 0}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          className={cn(
            'size-12 text-center text-lg tnum rounded-md bg-surface text-text',
            'border border-border-strong',
            'focus-visible:outline-2 focus-visible:outline-interactive focus-visible:outline-offset-0',
            'disabled:bg-surface-muted',
            invalid === true && 'border-danger',
          )}
        />
      ))}
    </div>
  );
}
