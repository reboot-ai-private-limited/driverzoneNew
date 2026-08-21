import { describe, expect, it } from 'vitest';
import { GetHealthUseCase } from '../src/modules/health/application/useCases/getHealth.usecase.js';
import { summarise } from '../src/modules/health/domain/health.entity.js';
import type { HealthProbePort } from '../src/modules/health/domain/healthProbe.port.js';

/**
 * No database, no Redis, no Express — the point of the architecture in one file.
 *
 * `GetHealthUseCase` is typed against `HealthProbePort`, so a fake satisfying that interface is
 * substitutable for the real Mongo adapter (Liskov, made concrete). If the use case imported
 * `MongoHealthProbe` directly, this test would need a running database to assert a branch that
 * has nothing to do with one.
 */
const probe = (name: string, status: 'up' | 'down'): HealthProbePort => ({
  name,
  check: async () => ({ name, status }),
});

describe('summarise', () => {
  it('is healthy when every dependency is up', () => {
    const r = summarise([{ name: 'a', status: 'up' }], 10);
    expect(r.status).toBe('healthy');
  });

  it('is degraded, not dead, when one is down', () => {
    const r = summarise([{ name: 'a', status: 'up' }, { name: 'b', status: 'down' }], 10);
    expect(r.status).toBe('degraded');
  });

  it('floors uptime to whole seconds', () => {
    expect(summarise([], 12.7).uptimeSeconds).toBe(12);
  });
});

describe('GetHealthUseCase', () => {
  it('reports healthy with all probes up', async () => {
    const r = await new GetHealthUseCase([probe('mongodb', 'up'), probe('redis', 'up')]).execute();
    expect(r.status).toBe('healthy');
    expect(r.dependencies).toHaveLength(2);
  });

  it('reports degraded when one probe is down', async () => {
    const r = await new GetHealthUseCase([probe('mongodb', 'up'), probe('redis', 'down')]).execute();
    expect(r.status).toBe('degraded');
  });

  it('keeps reporting the other dependencies when a probe throws', async () => {
    const thrower: HealthProbePort = {
      name: 'redis',
      check: () => Promise.reject(new Error('ECONNREFUSED')),
    };

    const r = await new GetHealthUseCase([probe('mongodb', 'up'), thrower]).execute();

    // The whole point of allSettled here: one blown probe must not erase what we know about
    // everything else.
    expect(r.dependencies).toHaveLength(2);
    expect(r.dependencies.find((d) => d.name === 'mongodb')?.status).toBe('up');
    expect(r.dependencies.find((d) => d.name === 'redis')?.status).toBe('down');
    expect(r.status).toBe('degraded');
  });
});
