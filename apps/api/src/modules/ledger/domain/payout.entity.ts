/**
 * DOMAIN — A settlement paid out to a driver.
 */

export type PayoutStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED';

export interface Payout {
  id: string;
  driverId: string;
  amountPaise: number;
  status: PayoutStatus;
  utr: string | null;
  notes: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

export interface NewPayout {
  driverId: string;
  amountPaise: number;
  status?: PayoutStatus | undefined;
  utr?: string | null | undefined;
  notes?: string | null | undefined;
  processedAt?: Date | null | undefined;
}
