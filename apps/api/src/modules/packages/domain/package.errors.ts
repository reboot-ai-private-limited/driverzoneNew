import { AppError } from '@/shared/errors/AppError.js';

export class PackageNotFoundError extends AppError {
  constructor(id: string) {
    super({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Package not found',
      publicDetails: { id },
      isExpected: true,
    });
  }
}

export class OverlappingBandError extends AppError {
  constructor(conflictId: string) {
    super({
      statusCode: 409,
      code: 'PACKAGE_BAND_OVERLAP',
      message: 'Distance band overlaps with an existing outstation package',
      publicDetails: { conflictingPackageId: conflictId },
      isExpected: true,
    });
  }
}

export class InvalidBandError extends AppError {
  constructor(reason: string) {
    super({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: reason,
      isExpected: true,
    });
  }
}

export class InvalidPackageError extends AppError {
  constructor(reason: string) {
    super({
      statusCode: 422,
      code: 'PACKAGE_NOT_SELLABLE',
      message: reason,
      isExpected: true,
    });
  }
}
