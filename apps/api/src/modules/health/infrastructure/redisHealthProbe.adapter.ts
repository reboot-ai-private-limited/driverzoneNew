import { redisHealth } from '@/shared/queue/redis.js';
import type { DependencyHealth } from '../domain/health.entity.js';
import type { HealthProbePort } from '../domain/healthProbe.port.js';

export class RedisHealthProbe implements HealthProbePort {
  readonly name = 'redis';

  async check(): Promise<DependencyHealth> {
    const started = Date.now();
    const { ok, state } = await redisHealth();
    return {
      name: this.name,
      status: ok ? 'up' : 'down',
      detail: state,
      latencyMs: Date.now() - started,
    };
  }
}
