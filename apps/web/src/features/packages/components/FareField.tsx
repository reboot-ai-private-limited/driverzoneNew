'use client';

import { FormField, Input } from '@driverzone/design-system';

/**
 * A rupee amount. Shared by both editors so the ₹ prefix and the input mode are decided once.
 *
 * `inputMode="numeric"`, NEVER `type="number"` — the settings screen documents why and it applies
 * doubly here: a spinner or a stray scroll wheel over a focused fare field changes what the
 * product costs, silently and without anything on screen looking wrong.
 */
export interface FareFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  disabled: boolean;
  required?: boolean;
}

export function FareField({
  label,
  hint,
  value,
  onChange,
  error,
  disabled,
  required,
}: FareFieldProps) {
  return (
    <FormField
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(required === true ? { required: true } : {})}
    >
      {({ id, invalid, describedBy }) => (
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle text-sm">
            ₹
          </span>
          <Input
            id={id}
            inputMode="numeric"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            invalid={invalid}
            aria-describedby={describedBy}
            disabled={disabled}
            className="pl-6"
          />
        </div>
      )}
    </FormField>
  );
}
