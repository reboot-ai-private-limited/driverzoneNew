import type { HealthReport } from './domain/health.entity.js';

/**
 * PUBLIC CONTRACT — the only surface other modules may import from `health`.
 *
 * Types only, so this file compiles to no JavaScript at all. A call through the contract is a
 * plain method call on the object the container injected: same machine code as calling the
 * class directly, zero runtime cost. Verify it yourself after a build —
 * `dist/modules/health/health.public.js` does not exist.
 *
 * Split by consumer (Interface Segregation). Today there is one consumer, so there is one
 * interface; when a second appears wanting something different, it gets its own rather than
 * widening this one. See docs/engineering/02-clean-architecture-and-solid.md.
 */
export interface HealthReportContract {
  /** The current report. Used by the admin dashboard's status tile. */
  report(): Promise<HealthReport>;
}

/** The whole surface, as returned by buildHealthContainer(). */
export type HealthPublicContract = HealthReportContract;

export type { DependencyHealth, HealthReport } from './domain/health.entity.js';
