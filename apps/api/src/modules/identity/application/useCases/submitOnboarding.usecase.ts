import { AppError } from '@/shared/errors/AppError.js';
import { canSubmit, missingForSubmission } from '../../domain/driverOnboarding.entity.js';
import type { DriverDocumentRepositoryPort } from '../../domain/driverDocument.repository.port.js';
import type { DriverProfileRepositoryPort } from '../../domain/driverProfile.repository.port.js';

export interface SubmitOnboardingResult {
  onboardingStatus: 'SUBMITTED';
}

/**
 * APPLICATION — a driver asking to be reviewed.
 *
 * The gate is `missingForSubmission`, and the list it returns goes straight into the 400 body.
 * That is why it returns paths rather than a boolean: "complete your profile" sends a driver
 * hunting through every screen, while `["dob", "documents.AADHAAR"]` lets the app deep-link to
 * exactly what is missing. Drivers abandoning onboarding is a supply problem, not just a UX one.
 */
export class SubmitOnboardingUseCase {
  constructor(
    private readonly drivers: DriverProfileRepositoryPort,
    private readonly documents: DriverDocumentRepositoryPort,
  ) {}

  async execute(driverId: string): Promise<SubmitOnboardingResult> {
    const profile = await this.drivers.findById(driverId);
    if (profile === undefined) throw AppError.notFound('Your profile could not be found.');

    /**
     * Already approved, or already waiting in the queue.
     *
     * Resubmitting from `SUBMITTED` is refused rather than treated as a harmless no-op: it would
     * reset the driver's position in the review queue, so a driver who taps twice would quietly
     * go to the back of the line.
     */
    if (!canSubmit(profile.onboardingStatus)) {
      throw AppError.conflict(
        profile.onboardingStatus === 'APPROVED'
          ? 'Your account is already approved.'
          : 'Your application is already being reviewed.',
        { onboarding_status: profile.onboardingStatus },
      );
    }

    const docs = await this.documents.listByDriver(driverId);
    const missing = missingForSubmission(profile, docs.map((d) => d.docType));

    if (missing.length > 0) {
      // `publicDetails`, not `details`: the caller cannot act without being told which fields —
      // that split is the whole point of AppError's two detail channels.
      throw AppError.badRequest("Your profile isn't complete yet.", { missing });
    }

    // Clears any previous rejection reason: this is a fresh application, and leaving stale text
    // behind would show a driver why they were rejected last time while they wait for a verdict
    // on something they have since fixed.
    const updated = await this.drivers.setOnboardingStatus(driverId, 'SUBMITTED', null);
    if (updated === undefined) throw AppError.notFound('Your profile could not be found.');

    return { onboardingStatus: 'SUBMITTED' };
  }
}
