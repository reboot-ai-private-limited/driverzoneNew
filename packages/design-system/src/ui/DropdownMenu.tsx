'use client';

import type { ReactNode } from 'react';
import * as Radix from '@radix-ui/react-dropdown-menu';
import { cn } from './cn';

export const DropdownMenu = Radix.Root;
export const DropdownMenuTrigger = Radix.Trigger;

export function DropdownMenuContent({
  children,
  align = 'end',
}: {
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <Radix.Portal>
      <Radix.Content
        align={align}
        sideOffset={4}
        // Opaque surface + border-strong, no shadow. See design-language.md §Principles.
        className="z-50 min-w-44 p-1 rounded-md bg-surface border border-border-strong"
      >
        {children}
      </Radix.Content>
    </Radix.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  icon,
  destructive,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <Radix.Item
      disabled={disabled ?? false}
      // Spread rather than `onSelect={onSelect}`: Radix types this as required-when-present,
      // and exactOptionalPropertyTypes refuses an explicit `undefined`.
      {...(onSelect === undefined ? {} : { onSelect: () => onSelect() })}
      className={cn(
        'flex items-center gap-2 px-2 h-8 rounded-sm text-sm cursor-pointer outline-none',
        'data-[highlighted]:bg-surface-muted data-[disabled]:opacity-40 data-[disabled]:cursor-default',
        destructive === true ? 'text-danger' : 'text-text',
      )}
    >
      {icon}
      {children}
    </Radix.Item>
  );
}

export function DropdownMenuSeparator() {
  return <Radix.Separator className="my-1 h-px bg-border" />;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return <Radix.Label className="px-2 py-1.5 text-xs text-text-subtle">{children}</Radix.Label>;
}
