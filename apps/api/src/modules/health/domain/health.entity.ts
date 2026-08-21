/**
 * DOMAIN — what a health report IS.
 *
 * No Express, no Mongoose, no winston. This layer describes the concept and nothing about how
 * it is delivered or stored, which is what lets the whole module be tested with no I/O.
 */

export type DependencyStatus = 'up' | 'down';

export interface DependencyHealth {
  name: string;
  status: DependencyStatus;
  /** Adapter-specific detail: a connection state, a version string. Never an error stack. */
  detail?: string;
  latencyMs?: number;
}

export interface HealthReport {
  status: 'healthy' | 'degraded';
  uptimeSeconds: number;
  checkedAt: Date;
  dependencies: DependencyHealth[];
}

/**
 * One dependency down means degraded, not dead.
 *
 * The distinction is what the container orchestrator acts on: a `degraded` API still serves
 * cached reads and should not be restarted, while restarting it drops every in-flight request
 * for a problem that is not in this process.
 */
export function summarise(deps: DependencyHealth[], uptimeSeconds: number): HealthReport {
  return {
    status: deps.every((d) => d.status === 'up') ? 'healthy' : 'degraded',
    uptimeSeconds: Math.floor(uptimeSeconds),
    checkedAt: new Date(),
    dependencies: deps,
  };
}
