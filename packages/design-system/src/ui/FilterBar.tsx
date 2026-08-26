'use client';

import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input } from './Input';
import { cn } from './cn';

/**
 * The strip above a list: search, a few filters, and a reset.
 *
 * Bordered but not a Panel — it is chrome for the table below it, not a separate object, and
 * nesting a Panel above a Panel is exactly the card-in-card the design language forbids.
 */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-end gap-4 p-4 bg-surface border border-border rounded-md',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5 min-w-40', className)}>
      <span className="text-xs font-medium text-text">{label}</span>
      {children}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search
        aria-hidden
        className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-text-subtle pointer-events-none"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
      />
    </div>
  );
}
