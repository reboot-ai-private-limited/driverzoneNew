import { AppError } from '@/shared/errors/AppError.js';
import type { AuditPort } from '../../domain/audit.port.js';
import type {
  CustomerProfile,
  CustomerProfilePatch,
  CustomerProfileRepositoryPort,
} from '../../domain/customerProfile.repository.port.js';
import type { ActorContext } from './verifyDriver.usecase.js';

/**
 * APPLICATION — reading and editing ONE customer as an admin.
 *
 * Audited, like every other admin action that touches somebody else's record (`architecture.md`;
 * `VerifyDriverUseCase` is the pattern). Reading is not audited — only the write is, because an
 * audit log that records every list view stops being readable long before it stops growing.
 */
export class ManageCustomerAdminUseCase {
  constructor(
    private readonly customers: CustomerProfileRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async get(customerId: string): Promise<CustomerProfile> {
    const customer = await this.customers.findById(customerId);
    if (customer === undefined) throw AppError.notFound('That customer could not be found.');
    return customer;
  }

  /**
   * Reads before writing, so the audit entry can carry `before` — and so an unknown id is a 404
   * rather than a silent no-op. `updateProfile` already returns undefined for a missing record,
   * but that answer arrives after the fact and cannot say what the record used to hold.
   */
  async update(
    customerId: string,
    patch: CustomerProfilePatch,
    actor: ActorContext,
  ): Promise<CustomerProfile> {
    const before = await this.get(customerId);

    const after = await this.customers.updateProfile(customerId, patch);
    if (after === undefined) throw AppError.notFound('That customer could not be found.');

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'Customer',
      entityId: customerId,
      action: 'UPDATE',
      // Only the fields this request actually touched. Whole documents either side would put two
      // more copies of the customer's PII into a collection with a different retention story —
      // see the note on `AuditEntry`.
      before: changedFields(before, patch),
      after: changedFields(after, patch),
      ip: actor.ip,
    });

    return after;
  }
}

/** The values of exactly the fields the patch mentions — nothing else reaches the audit log. */
function changedFields(
  profile: CustomerProfile,
  patch: CustomerProfilePatch,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.fullName !== undefined) out['fullName'] = profile.fullName;
  if (patch.dob !== undefined) out['dob'] = profile.dob;
  if (patch.gender !== undefined) out['gender'] = profile.gender;
  if (patch.alternatePhone !== undefined) out['alternatePhone'] = profile.alternatePhone;
  if (patch.isBlocked !== undefined) out['isBlocked'] = profile.isBlocked;
  return out;
}
