import { mongoHealth } from '@/shared/db/mongo.js';
import type { DependencyHealth } from '../domain/health.entity.js';
import type { HealthProbePort } from '../domain/healthProbe.port.js';

/**
 * INFRASTRUCTURE — an adapter. The only layer permitted to know Mongoose exists.
 *
 * Implements the port by satisfying its shape; nothing here is referenced by name outside
 * `health.container.ts`.
 */
export class MongoHealthProbe implements HealthProbePort {
  readonly name = 'mongodb';

  async check(): Promise<DependencyHealth> {
    const started = Date.now();
    const { ok, state } = mongoHealth();
    return {
      name: this.name,
      status: ok ? 'up' : 'down',
      detail: state,
      latencyMs: Date.now() - started,
    };
  }
}
