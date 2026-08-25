'use client';

import * as Radix from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Radix's select rather than a native `<select>`: the trigger can be styled to match the rest
 * of the form (a native select cannot, on any browser worth supporting), and Radix keeps the
 * typeahead, arrow-key and escape behaviour a native one gives for free.
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  id,
  disabled,
  className,
}: SelectProps) {
  return (
    <Radix.Root value={value} onValueChange={onValueChange} disabled={disabled ?? false}>
      <Radix.Trigger
        id={id}
        className={cn(
          'inline-flex items-center justify-between gap-2 h-10 w-full px-2 rounded-md',
          'bg-surface text-sm text-text border border-border-strong',
          'data-[placeholder]:text-text-subtle disabled:bg-surface-muted',
          className,
        )}
      >
        <Radix.Value placeholder={placeholder} />
        <Radix.Icon>
          <ChevronDown aria-hidden className="size-4 text-text-subtle" />
        </Radix.Icon>
      </Radix.Trigger>

      <Radix.Portal>
        <Radix.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] p-1 rounded-md bg-surface border border-border-strong"
        >
          <Radix.Viewport>
            {options.map((option) => (
              <Radix.Item
                key={option.value}
                value={option.value}
                className={cn(
                  'flex items-center justify-between gap-2 px-2 h-8 rounded-sm text-sm text-text',
                  'cursor-pointer outline-none data-[highlighted]:bg-surface-muted',
                )}
              >
                <Radix.ItemText>{option.label}</Radix.ItemText>
                <Radix.ItemIndicator>
                  <Check aria-hidden className="size-3.5 text-interactive" />
                </Radix.ItemIndicator>
              </Radix.Item>
            ))}
          </Radix.Viewport>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
