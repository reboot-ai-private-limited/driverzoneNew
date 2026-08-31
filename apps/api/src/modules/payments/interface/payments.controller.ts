import type { RequestHandler } from 'express';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/response.util.js';
import { getRawBody } from '../../../shared/http/rawBody.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { WebhookSignatureError } from '../domain/payment.errors.js';
import type { HandleWebhookUseCase, WebhookOutcome } from '../application/useCases/handleWebhook.usecase.js';

/**
 * The signature header. Providers each pick their own name; when a real one is wired in, this
 * moves to the adapter alongside `verifyWebhook` rather than staying a constant here.
 */
const SIGNATURE_HEADER = 'x-payment-signature';

/**
 * Called by the payment provider, never by an app.
 *
 * ALWAYS ANSWERS 200 ONCE THE SIGNATURE VERIFIES, whatever the outcome. A replayed event, an
 * event for a payment we do not recognise, an event that no longer applies — all of them are
 * "received, nothing to do", and a non-2xx would make the provider redeliver something that will
 * fail identically forever. Only a bad signature is an error, and that is a 401.
 *
 * `onHandled` is how the booking side learns a payment settled. It is injected rather than called
 * directly because `payments` is tier 2 and `bookings` is tier 6 — the dependency has to point
 * downward, so the container wires a callback in instead.
 */
export function makeWebhookController(
  useCase: HandleWebhookUseCase,
  onHandled: (outcome: Extract<WebhookOutcome, { handled: true }>) => Promise<void>,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const signature = req.get(SIGNATURE_HEADER);
    if (signature === undefined || signature === '') throw new WebhookSignatureError();

    const rawBody = getRawBody(req);
    if (rawBody === undefined) {
      // The raw-body capture in app.ts is keyed on this route. If it did not fire, the signature
      // can never verify, and silently answering 401 would look like a provider misconfiguration
      // for as long as it took someone to check.
      throw AppError.internal('INTERNAL', {
        reason: 'Webhook raw body was not captured — check the express.json verify hook in app.ts',
      });
    }

    const outcome = await useCase.execute(rawBody, signature);

    if (outcome.handled) await onHandled(outcome);

    sendSuccess(req, res, { received: true }, 'Webhook received');
  });
}
