import { AppError } from '../../../../shared/errors/AppError.js';
import {
  applyWalletToFare,
  validateWalletEntry,
  type NewWalletEntry,
  type WalletApplication,
  type WalletEntry,
} from '../../domain/walletEntry.entity.js';
import type { WalletRepositoryPort } from '../../domain/walletRepository.port.js';

/** How much of a customer's statement one read returns. A wallet is not a paginated surface yet. */
const STATEMENT_LIMIT = 100;

export interface CustomerWalletView {
  balancePaise: number;
  entries: WalletEntry[];
}

/**
 * Reading a wallet, and the only sanctioned way of writing to one.
 *
 * EVERY WRITE GOES THROUGH `append`, INCLUDING ADMIN GRANTS. There is no "set the balance"
 * operation anywhere in the module, because a balance that can be set is a balance nobody can
 * explain afterwards — and "why do I owe ₹200" is precisely the question this data exists to
 * answer.
 *
 * VALIDATION IS DOMAIN, NOT ZOD. `validateWalletEntry` runs here rather than only at the HTTP
 * boundary, because the booking module writes to this contract directly and never passes through
 * a request schema. A wrongly-signed row is equally wrong whichever door it came in by.
 */
export class ManageWalletUseCase {
  constructor(private readonly repo: WalletRepositoryPort) {}

  async append(entries: readonly NewWalletEntry[]): Promise<WalletEntry[]> {
    for (const entry of entries) {
      const problem = validateWalletEntry(entry);
      if (problem !== null) {
        throw AppError.badRequest(problem, { entryType: entry.entryType });
      }
    }

    return this.repo.append(entries);
  }

  /** Summed from the rows. The cache on `customers` is not consulted and is not authoritative. */
  async balance(customerId: string): Promise<number> {
    return this.repo.sumForCustomer(customerId);
  }

  async view(customerId: string): Promise<CustomerWalletView> {
    const [balancePaise, entries] = await Promise.all([
      this.repo.sumForCustomer(customerId),
      this.repo.listForCustomer(customerId, STATEMENT_LIMIT),
    ]);

    return { balancePaise, entries };
  }

  /**
   * What this customer's balance does to a fare, without writing anything.
   *
   * Read-only on purpose: `createBooking` needs the figure BEFORE it has a booking id to attach
   * the rows to, and a booking that fails to save must not have spent anybody's credit.
   */
  async planFor(customerId: string, farePaise: number): Promise<WalletApplication> {
    return applyWalletToFare(await this.repo.sumForCustomer(customerId), farePaise);
  }

  entriesForBooking(bookingId: string): Promise<WalletEntry[]> {
    return this.repo.listForBooking(bookingId);
  }
}
