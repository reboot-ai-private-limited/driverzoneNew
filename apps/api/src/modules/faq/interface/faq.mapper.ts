import type { FaqDto } from '@driverzone/contracts';
import type { FaqItem } from '../domain/faq.entity.js';

/**
 * INTERFACE — domain shape to wire shape. The one place `camelCase` becomes `snake_case` and a
 * `Date` becomes an ISO string, so no controller has to remember either.
 */
export function toFaqDto(faq: FaqItem): FaqDto {
  return {
    id: faq.id,
    question: faq.question,
    answer: faq.answer,
    sort_order: faq.sortOrder,
    is_published: faq.isPublished,
    updated_at: faq.updatedAt.toISOString(),
  };
}
