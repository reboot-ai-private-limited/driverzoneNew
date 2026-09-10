import { publishedOnly, type FaqItem } from '../../domain/faq.entity.js';
import type { FaqRepositoryPort } from '../../domain/faq.repository.port.js';

/**
 * APPLICATION — what a customer or driver app receives.
 *
 * THE ONLY USE CASE THE AUDIENCE ROUTES CAN REACH, which is what makes "a draft never leaves the
 * building" structural rather than a convention someone has to remember. Both apps read the same
 * list: an FAQ about who pays for the driver's dinner is a fact about the trip, and the two sides
 * of that trip disagreeing about it is precisely the argument these FAQs exist to prevent.
 */
export class ListPublishedFaqsUseCase {
  constructor(private readonly repo: FaqRepositoryPort) {}

  async execute(): Promise<FaqItem[]> {
    return publishedOnly(await this.repo.findAll());
  }
}
