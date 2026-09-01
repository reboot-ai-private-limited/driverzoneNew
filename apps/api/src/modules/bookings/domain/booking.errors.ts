import type { BookingStatus } from '@driverzone/contracts';
import { AppError } from '../../../shared/errors/AppError.js';

export class BookingNotFoundError extends AppError {
  constructor(id: string) {
    super({
      statusCode: 404,
      code: 'BOOKING_NOT_FOUND',
      message: 'No such booking',
      details: { id },
      isExpected: true,
    });
  }
}

/**
 * The requested move is not in the transition table, or the booking left the status the caller
 * believed it was in.
 *
 * 409, and it carries both statuses in `publicDetails` — the app needs to know what the booking
 * actually is now so it can re-render rather than just showing an error. This is the ordinary
 * outcome of a customer cancelling at the same instant a driver accepts, not a fault.
 */
export class InvalidTransitionError extends AppError {
  constructor(reference: string, from: BookingStatus, to: BookingStatus) {
    super({
      statusCode: 409,
      code: 'INVALID_BOOKING_TRANSITION',
      message: `${reference} is ${from} and cannot become ${to}`,
      publicDetails: { from, to },
      isExpected: true,
    });
  }
}

/**
 * Wrong trip-start OTP.
 *
 * Says nothing about WHY. A message distinguishing "wrong code" from "no such booking" is an
 * oracle for guessing at other people's trips, and the driver's next action is the same either
 * way: ask the customer to read it again.
 */
export class InvalidOtpError extends AppError {
  constructor(attemptsRemaining: number) {
    super({
      statusCode: 400,
      code: 'OTP_INVALID',
      message: 'That code is not right. Ask the customer to read it out again.',
      publicDetails: { attempts_remaining: attemptsRemaining },
      isExpected: true,
    });
  }
}

export class OtpLockedError extends AppError {
  constructor() {
    super({
      statusCode: 429,
      code: 'OTP_LOCKED',
      message: 'Too many incorrect codes. Please call support to start this trip.',
      isExpected: true,
    });
  }
}

/**
 * The driver is too far from the pickup point to mark themselves arrived.
 *
 * 422 CARRYING THE DISTANCE, so the app can say "you are 1.2 km away" instead of refusing
 * mutely. This is the one gate in the flow that blocks rather than warns: reaching ARRIVED starts
 * the waiting-charge clock, so marking it from the highway bills a customer for time nobody spent
 * waiting. Trip START keeps the documented warn-and-log behaviour, because by then the customer
 * is in the car and blocking would strand a trip that is genuinely happening.
 */
export class DriverNotAtPickupError extends AppError {
  constructor(distanceMetres: number, allowedMetres: number) {
    super({
      statusCode: 422,
      code: 'DRIVER_NOT_AT_PICKUP',
      message: 'You are not at the pickup point yet.',
      publicDetails: { distance_metres: distanceMetres, allowed_metres: allowedMetres },
      isExpected: true,
    });
  }
}

/** A fix too old to prove where somebody is now. */
export class StaleLocationError extends AppError {
  constructor() {
    super({
      statusCode: 400,
      code: 'DRIVER_LOCATION_STALE',
      message: 'Your location is out of date. Check your GPS and try again.',
      isExpected: true,
    });
  }
}

/** The booking cannot advance because its payment has not been captured. */
export class PaymentRequiredError extends AppError {
  constructor(reference: string) {
    super({
      statusCode: 402,
      code: 'PAYMENT_REQUIRED',
      message: `${reference} is not confirmed yet — its payment has not gone through.`,
      isExpected: true,
    });
  }
}
