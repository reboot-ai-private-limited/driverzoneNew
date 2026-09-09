import type { DutySession } from './dutySession.entity.js';

export interface DutySessionRepositoryPort {
  /**
   * Starts a new duty session for the driver. If an active session is already open,
   * it returns the existing active session without creating a duplicate.
   */
  startSession(driverId: string, startedAt?: Date): Promise<DutySession>;

  /**
   * Closes any currently active session (endedAt == null) for the driver.
   * Computes the final duration and returns the updated session, or null if none was active.
   */
  endActiveSession(driverId: string, endedAt?: Date): Promise<DutySession | null>;

  /**
   * Returns the currently open session for the driver, or null if offline.
   */
  getActiveSession(driverId: string): Promise<DutySession | null>;

  /**
   * Retrieves paginated duty sessions for a driver, ordered most recent first.
   */
  findPaginatedByDriver(
    driverId: string,
    page: number,
    limit: number
  ): Promise<{ sessions: DutySession[]; totalItems: number }>;
}
