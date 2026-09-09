import type { AdminDriverDutyHistoryDto, DutySessionDto } from '@driverzone/contracts';
import type { DutySessionRepositoryPort } from '../../domain/dutySession.repository.port.js';
import type { DutySession } from '../../domain/dutySession.entity.js';

export class GetDriverDutyHistoryAdminUseCase {
  constructor(private readonly dutySessions: DutySessionRepositoryPort) {}

  async execute(
    driverId: string,
    page = 1,
    limit = 10
  ): Promise<AdminDriverDutyHistoryDto> {
    const { sessions, totalItems } = await this.dutySessions.findPaginatedByDriver(
      driverId,
      page,
      limit
    );

    const mappedSessions: DutySessionDto[] = sessions.map((session: DutySession) => ({
      id: session.id,
      driver_id: session.driverId,
      started_at: session.startedAt.toISOString(),
      ended_at: session.endedAt ? session.endedAt.toISOString() : null,
      duration_minutes: session.calculateDurationMinutes(),
      trips_completed: session.tripsCompleted,
      earnings_paise: session.earningsPaise,
    }));

    return {
      sessions: mappedSessions,
      pagination: {
        page,
        limit,
        total_items: totalItems,
        total_pages: Math.max(1, Math.ceil(totalItems / limit)),
      },
    };
  }
}
