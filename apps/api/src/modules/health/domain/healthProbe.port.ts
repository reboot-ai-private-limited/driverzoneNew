import type { DependencyHealth } from './health.entity.js';

/**
 * PORT — what the domain NEEDS, expressed without naming who provides it.
 *
 * Declared here in domain/ rather than beside its implementation, and that placement is the
 * whole of dependency inversion in one file: the use case imports this interface, the adapters
 * in infrastructure/ implement it, and the arrow points inward. Move this file next to the
 * Mongo adapter and the use case would import from infrastructure/ — which `.dependency-cruiser.cjs`
 * forbids, because at that point the database owns the shape rather than the domain.
 */
export interface HealthProbePort {
  readonly name: string;
  check(): Promise<DependencyHealth>;
}
