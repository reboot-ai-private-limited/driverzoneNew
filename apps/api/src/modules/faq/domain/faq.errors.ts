import { AppError } from '@/shared/errors/AppError.js';

/**
 * DOMAIN — the failures this module is allowed to express.
 *
 * Factories rather than subclasses, same reasoning as `zones/domain/zone.errors.ts`: `AppError`
 * already carries everything that varies.
 */

/**
 * A write named an id that is not in the collection.
 *
 * 422 rather than 404, because the request is not FOR that entry — it is a whole list that
 * happens to mention it. The likely cause is two admins on the settings page at once, one having
 * deleted a row the other's page still shows. `publicDetails` names the ids so the panel can say
 * which rows went stale rather than "something changed, reload".
 */
export function faqNotFound(ids: readonly string[]): AppError {
  return new AppError({
    statusCode: 422,
    code: 'FAQ_NOT_FOUND',
    message:
      ids.length === 1
        ? 'One of these FAQs no longer exists — someone else may have deleted it. Reload and try again.'
        : 'Some of these FAQs no longer exist — someone else may have deleted them. Reload and try again.',
    publicDetails: { ids: [...ids] },
  });
}
