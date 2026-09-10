/**
 * Duty and driver operations wire types.
 */

export const DUTY_STATUSES = ['ONLINE', 'OFFLINE'] as const;
export type DutyStatus = (typeof DUTY_STATUSES)[number];

/** `POST /driver/duty` — the driver going on or off duty. */
export interface SetDutyStatusRequest {
  status: DutyStatus;
}

/**
 * The answer is the resulting STATE, not an echo of the request.
 *
 * A driver whose documents expired mid-shift can ask to go ONLINE and be refused; returning what
 * the server now believes — rather than what was asked for — is what stops the app from painting
 * itself on duty when dispatch will never ring it.
 */
export interface DutyStateDto {
  is_on_duty: boolean;
}

/**
 * One GPS fix. `recorded_at` is CLIENT-supplied on purpose: the app buffers while offline and
 * flushes on reconnect, so the moment a fix was taken and the moment it arrives are different
 * facts and only the client knows the first.
 */
export interface LocationPingDto {
  lat: number;
  lng: number;
  /** ISO-8601. When the fix was TAKEN, not when it was sent. */
  recorded_at: string;
}

/**
 * `POST /driver/location` — a BATCH, never one request per fix.
 *
 * One HTTP call per GPS fix drains a driver's battery and, at scale, costs a driver base
 * (docs/LLD/api-contracts.md).
 *
 * STEADY STATE IS ONE PING. The array is not a sampling window: the server keeps only the newest
 * fix and picks it by `recorded_at`, so a batch of five is four rows discarded without ever being
 * compared. `apps/driver` therefore takes one fix per flush. The array survives because the app
 * buffers while offline and flushes what accumulated on reconnect — that is the case it exists
 * for, and it is why the endpoint still accepts many. Ordered oldest first.
 */
export interface SendLocationPingsRequest {
  pings: LocationPingDto[];
}

export interface LocationPingsAcceptedDto {
  /** How many of the batch were stored. */
  accepted: number;
  /**
   * Whether the driver is still on duty.
   *
   * Piggy-backed on the ping the app is already making, so a driver taken off duty
   * server-side — expired documents, an admin block — finds out within one ping instead of
   * on their next cold start.
   */
  is_on_duty: boolean;
}

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

/**
 * `POST /driver/devices` — register this handset for push.
 *
 * Sent on sign-in and whenever FCM rotates the token. Without a registered token the server has
 * no address to ring, and every offer to this driver lands as a `NONE` delivery.
 */
export interface RegisterDeviceRequest {
  fcm_token: string;
  /** Android only today; the field exists so an iOS driver app would not need a new endpoint. */
  platform: 'android' | 'ios';
  app_version?: string | undefined;
}

export interface RegisterDeviceResponse {
  registered: true;
}
