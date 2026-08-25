import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, with later Tailwind utilities beating earlier ones.
 *
 * Plain `clsx` would emit `px-4 px-6` and let CSS source order decide, which means a caller
 * cannot reliably override a component's padding — the fix would be prop drilling every
 * spacing decision. `twMerge` resolves the conflict by keeping the last one.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
