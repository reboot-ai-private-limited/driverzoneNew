import { summarise } from '../../domain/health.entity.js';
import type { HealthReport } from '../../domain/health.entity.js';
import type { HealthProbePort } from '../../domain/healthProbe.port.js';

/**
 * APPLICATION — orchestrates the domain to answer one question. Owns no rules of its own.
 *
 * Typed against `HealthProbePort[]`, never against the Mongo or Redis adapter. That is what
 * makes the test below possible with two three-line fakes and no running database:
 *
 *   new GetHealthUseCase([{ name: 'x', check: async () => ({ name: 'x', status: 'down' }) }])
 */
export class GetHealthUseCase {
  constructor(
    private readonly probes: HealthProbePort[],
    private readonly uptime: () => number = () => process.uptime(),
  ) {}

  async execute(): Promise<HealthReport> {
    // Parallel, and settled rather than all: one probe throwing must not hide the status of
    // every other dependency — that turns a Redis blip into "we know nothing about anything".
    const results = await Promise.allSettled(this.probes.map((p) => p.check()));

    const deps = results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : {
            name: this.probes[i]?.name ?? 'unknown',
            status: 'down' as const,
            detail: 'probe threw',
          },
    );

    return summarise(deps, this.uptime());
  }
}
