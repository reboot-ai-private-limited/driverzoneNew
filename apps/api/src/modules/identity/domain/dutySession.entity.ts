/**
 * DOMAIN ENTITY — one continuous shift during which a driver was marked on duty.
 *
 * A session starts when the driver transitions from offline to online, and ends
 * when they toggle off-duty, their documents expire, or an admin suspends them.
 */

export interface DutySessionProps {
  id: string;
  driverId: string;
  startedAt: Date;
  endedAt: Date | null;
  durationMinutes: number;
  tripsCompleted: number;
  earningsPaise: number;
  createdAt: Date;
  updatedAt: Date;
}

export class DutySession {
  readonly id: string;
  readonly driverId: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly durationMinutes: number;
  readonly tripsCompleted: number;
  readonly earningsPaise: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: DutySessionProps) {
    this.id = props.id;
    this.driverId = props.driverId;
    this.startedAt = props.startedAt;
    this.endedAt = props.endedAt;
    this.durationMinutes = props.durationMinutes;
    this.tripsCompleted = props.tripsCompleted;
    this.earningsPaise = props.earningsPaise;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(id: string, driverId: string, startedAt = new Date()): DutySession {
    const now = new Date();
    return new DutySession({
      id,
      driverId,
      startedAt,
      endedAt: null,
      durationMinutes: 0,
      tripsCompleted: 0,
      earningsPaise: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Computes duration in minutes. If the session has ended, uses endedAt.
   * If still open, calculates elapsed time up to referenceDate (defaults to now).
   */
  calculateDurationMinutes(referenceDate = new Date()): number {
    const end = this.endedAt ?? referenceDate;
    const diffMs = Math.max(0, end.getTime() - this.startedAt.getTime());
    return Math.floor(diffMs / (1000 * 60));
  }
}
