import type { FaqItem } from '../../domain/faq.entity.js';
import type { FaqRepositoryPort } from '../../domain/faq.repository.port.js';

/**
 * APPLICATION — the admin's view of the FAQs: every entry, drafts included, in order.
 *
 * Separate from `ListPublishedFaqsUseCase` rather than one use case with a flag. A boolean
 * parameter is a thing a controller can get wrong, and getting it wrong here means publishing
 * ops' half-written drafts to every customer. Two use cases, and the audience controllers can
 * only reach the one that filters.
 */
export class ListFaqsUseCase {
  constructor(private readonly repo: FaqRepositoryPort) {}

  async execute(): Promise<FaqItem[]> {
    return this.repo.findAll();
  }
}
