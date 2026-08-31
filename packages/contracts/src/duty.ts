/**
 * Duty and driver operations wire types.
 */

export const DUTY_STATUSES = ['ONLINE', 'OFFLINE'] as const;
export type DutyStatus = (typeof DUTY_STATUSES)[number];

export interface DutySessionDto {
  id: string;
  driver_id: string;
  /** ISO-8601 timestamp when the driver went online */
  started_at: string;
  /** ISO-8601 timestamp when the driver went offline. Null if currently active. */
  ended_at: string | null;
  /** Duration of the session in minutes. If active, duration up to current time. */
  duration_minutes: number;
  /** Total number of trips completed during this specific session. */
  trips_completed: number;
  /** Total value of trips completed during this session, in integer paise. */
  earnings_paise: number;
}

export interface AdminDriverDutyHistoryDto {
  sessions: DutySessionDto[];
  pagination: {
    page: number;
    limit: number;
    total_items: number;
    total_pages: number;
  };
}
