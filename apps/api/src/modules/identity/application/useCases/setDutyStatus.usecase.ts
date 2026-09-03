import type { DutyStatus } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import type { DriverProfileRepositoryPort } from '../../domain/driverProfile.repository.port.js';

export interface SetDutyStatusResult {
  isOnDuty: boolean;
}

/**
 * APPLICATION — a driver going on or off duty.
 *
 * Duty is the flag `MongoDriverPool` filters on when a wave picks who to ring, which is why it
 * lives on the server rather than in the app: a driver "on duty" only in their own app's memory
 * is offered nothing and has no way to tell.
 *
 * **Going ON is gated, going OFF never is.** Approval, and later expired documents or a blocked
 * wallet, decide whether someone may take work — but nothing should ever trap a driver online.
 * A driver who wants to stop must always be able to stop, or the app becomes something they
 * fight rather than use.
 */
export class SetDutyStatusUseCase {
  constructor(private readonly drivers: DriverProfileRepositoryPort) {}

  async execute(driverId: string, status: DutyStatus): Promise<SetDutyStatusResult> {
    const profile = await this.drivers.findById(driverId);
    if (profile === undefined) throw AppError.notFound('Your profile could not be found.');

    if (status === 'ONLINE' && !profile.isVerified) {
      /*
       * 409, not 403: nothing about the request is wrong, the account is simply not in a state
       * that allows it yet — and the driver's next move is to finish onboarding, not to
       * re-authenticate. `onboarding_status` rides along so the app can route them there.
       */
      throw AppError.conflict('Your account is not approved for trips yet.', {
        onboarding_status: profile.onboardingStatus,
      });
    }

    const updated = await this.drivers.setDutyStatus(driverId, status === 'ONLINE');
    if (updated === undefined) throw AppError.notFound('Your profile could not be found.');

    return { isOnDuty: updated.isOnDuty };
  }
}
