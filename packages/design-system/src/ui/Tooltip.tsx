'use client';

import type { ReactNode } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';

/** Mount once, near the root. Radix shares open/close timing across every tooltip under it. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={300} skipDelayDuration={150}>
      {children}
    </RadixTooltip.Provider>
  );
}

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * NO SHADOW, per the design language. An overlay reads as above the page through an opaque
 * surface and a border-strong edge instead.
 *
 * A tooltip is never the only place information lives. The collapsed nav labels its items here
 * AND keeps them in the accessibility tree, because a tooltip is unreachable by touch.
 */
export function Tooltip({ content, children, side = 'right' }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 px-2 py-1 rounded-sm bg-surface border border-border-strong text-xs text-text max-w-xs"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
