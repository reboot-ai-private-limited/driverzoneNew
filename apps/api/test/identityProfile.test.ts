import { describe, expect, it } from 'vitest';
import {
  applyAddressFlags,
  applyVehicleFlags,
  defaultsForFirstAddress,
  findAddressAtSamePlace,
  findVehicleByPlate,
  normalisePlate,
} from '../src/modules/identity/domain/customerProfile.entity.js';
import {
  canReview,
  canSubmit,
  missingForSubmission,
} from '../src/modules/identity/domain/driverOnboarding.entity.js';
import { ManageAddressesUseCase } from '../src/modules/identity/application/useCases/manageAddresses.usecase.js';
import { ManageVehiclesUseCase } from '../src/modules/identity/application/useCases/manageVehicles.usecase.js';
import { UpsertFromBookingUseCase } from '../src/modules/identity/application/useCases/upsertFromBooking.usecase.js';
import { SubmitOnboardingUseCase } from '../src/modules/identity/application/useCases/submitOnboarding.usecase.js';
import { VerifyDriverUseCase } from '../src/modules/identity/application/useCases/verifyDriver.usecase.js';
import type { SavedAddress, Vehicle } from '../src/modules/identity/domain/customerProfile.entity.js';
import type {
  CustomerProfile,
  CustomerProfileRepositoryPort,
} from '../src/modules/identity/domain/customerProfile.repository.port.js';
import type {
  DriverProfile,
  DriverProfileRepositoryPort,
} from '../src/modules/identity/domain/driverProfile.repository.port.js';
import type {
  DriverDocument,
  DriverDocumentRepositoryPort,
} from '../src/modules/identity/domain/driverDocument.repository.port.js';
import type { AuditEntry, AuditPort } from '../src/modules/identity/domain/audit.port.js';
import type { AppError } from '../src/shared/errors/AppError.js';

/**
 * The profile, onboarding and verification rules, with no Mongo and no Express.
 *
 * The invariants exercised here are the ones that break silently rather than loudly: two default
 * addresses is not a crash, it is a booking flow that prefills the wrong pickup point months
 * later. They are worth a disproportionate share of the suite.
 */

// ─── Fakes ──────────────────────────────────────────────────────────────────────────────────

function address(id: string, over: Partial<SavedAddress> = {}): SavedAddress {
  return {
    id,
    label: 'HOME',
    address: `${id} street`,
    lat: 26.7271,
    lng: 88.3953,
    isDefault: false,
    isPreferredPickup: false,
    ...over,
  };
}

function vehicle(id: string, over: Partial<Vehicle> = {}): Vehicle {
  return { id, category: 'SEDAN', plateNumber: 'WB74AB1234', fuelType: null, isDefault: false, ...over };
}

function fakeCustomers(seed: { addresses?: SavedAddress[]; vehicles?: Vehicle[] } = {}): CustomerProfileRepositoryPort & {
  addresses: SavedAddress[];
  vehicles: Vehicle[];
} {
  const state = { addresses: seed.addresses ?? [], vehicles: seed.vehicles ?? [] };
  const profile = (): CustomerProfile => ({
    id: 'cus_1',
    mobileNumber: '+919876543210',
    fullName: null,
    dob: null,
    gender: null,
    languagesKnown: [],
    alternatePhone: null,
    emergencyContact: null,
    savedAddresses: state.addresses,
    vehicles: state.vehicles,
  });

  return {
    get addresses() {
      return state.addresses;
    },
    get vehicles() {
      return state.vehicles;
    },
    findById: () => Promise.resolve(profile()),
    updateProfile: () => Promise.resolve(profile()),
    replaceAddresses: (_id, next) => {
      state.addresses = next;
      return Promise.resolve(next);
    },
    replaceVehicles: (_id, next) => {
      state.vehicles = next;
      return Promise.resolve(next);
    },
  };
}

function driverProfile(over: Partial<DriverProfile> = {}): DriverProfile {
  return {
    id: 'drv_1',
    mobileNumber: '+919800011122',
    fullName: 'Bimal Rai',
    dob: new Date('1988-07-04'),
    gender: 'MALE',
    experienceYears: 6,
    alternatePhone: null,
    emergencyContact: null,
    address: 'Matigara, Siliguri',
    vehicleTypePreference: null,
    vehicleCategoryPreference: [],
    canDriveHill: false,
    canDriveHillVerified: false,
    onboardingStatus: 'INCOMPLETE',
    onboardingRejectionReason: null,
    isVerified: false,
    ...over,
  };
}

function fakeDrivers(initial: DriverProfile): DriverProfileRepositoryPort & { current: DriverProfile } {
  let current = initial;
  return {
    get current() {
      return current;
    },
    findById: () => Promise.resolve(current),
    updateProfile: () => Promise.resolve(current),
    setOnboardingStatus: (_id, status, reason) => {
      current = { ...current, onboardingStatus: status, onboardingRejectionReason: reason, isVerified: false };
      return Promise.resolve(current);
    },
    approve: () => {
      current = { ...current, onboardingStatus: 'APPROVED', isVerified: true, onboardingRejectionReason: null };
      return Promise.resolve(current);
    },
  };
}

function doc(over: Partial<DriverDocument> = {}): DriverDocument {
  return {
    id: 'doc_1',
    driverId: 'drv_1',
    docType: 'LICENCE',
    status: 'PENDING',
    rejectionReason: null,
    fileUrl: 'drivers/drv_1/licence/abc',
    number: null,
    subType: null,
    issuedOn: null,
    expiresOn: null,
    ...over,
  };
}

function fakeDocuments(list: DriverDocument[] = []): DriverDocumentRepositoryPort & { list: DriverDocument[] } {
  let current = list;
  return {
    get list() {
      return current;
    },
    listByDriver: () => Promise.resolve(current),
    findById: (id) => Promise.resolve(current.find((d) => d.id === id)),
    upsert: () => Promise.resolve(doc()),
    review: (id, status, reason) => {
      current = current.map((d) => (d.id === id ? { ...d, status, rejectionReason: reason } : d));
      return Promise.resolve(current.find((d) => d.id === id));
    },
  };
}

function fakeAudit(): AuditPort & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return {
    entries,
    record: (e) => {
      entries.push(e);
      return Promise.resolve();
    },
  };
}

async function codeOfRejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'DID_NOT_THROW';
  } catch (err) {
    return (err as AppError).code;
  }
}

// ─── Address and vehicle invariants ─────────────────────────────────────────────────────────

describe('applyAddressFlags', () => {
  it('clears the previous default when a new one wins', () => {
    const list = [address('a', { isDefault: true }), address('b', { isDefault: true })];

    const result = applyAddressFlags(list, 'b');

    expect(result.find((a) => a.id === 'a')?.isDefault).toBe(false);
    expect(result.find((a) => a.id === 'b')?.isDefault).toBe(true);
  });

  /**
   * The two flags are independent, and this is the test that stops someone "simplifying" them
   * into one. A customer may default to their office in the address book while still preferring
   * pickup from home.
   */
  it('does not touch preferred-pickup when only the default changed', () => {
    const list = [
      address('home', { isPreferredPickup: true }),
      address('office', { isDefault: true }),
    ];

    const result = applyAddressFlags(list, 'office');

    expect(result.find((a) => a.id === 'home')?.isPreferredPickup).toBe(true);
    expect(result.find((a) => a.id === 'office')?.isDefault).toBe(true);
  });

  it('leaves the list alone when the winner is not in it', () => {
    const list = [address('a', { isDefault: true })];

    expect(applyAddressFlags(list, 'missing')).toEqual(list);
  });
});

describe('applyVehicleFlags', () => {
  it('allows only one default vehicle', () => {
    const list = [vehicle('v1', { isDefault: true }), vehicle('v2', { isDefault: true })];

    const result = applyVehicleFlags(list, 'v2');

    expect(result.filter((v) => v.isDefault)).toHaveLength(1);
    expect(result.find((v) => v.id === 'v2')?.isDefault).toBe(true);
  });

  it('leaves other vehicles alone when the winner is not itself default', () => {
    const list = [vehicle('v1', { isDefault: true }), vehicle('v2')];

    expect(applyVehicleFlags(list, 'v2')).toEqual(list);
  });
});

describe('defaultsForFirstAddress', () => {
  /** With one possible answer, making the customer pick it is pure friction. */
  it('makes the very first address both default and preferred pickup', () => {
    expect(defaultsForFirstAddress(0)).toEqual({ isDefault: true, isPreferredPickup: true });
  });

  it('promotes nothing once the customer already has addresses', () => {
    expect(defaultsForFirstAddress(3)).toEqual({ isDefault: false, isPreferredPickup: false });
  });
});

describe('matching', () => {
  it('treats plates as equal regardless of case and separators', () => {
    expect(normalisePlate('wb 74 ab-1234')).toBe('WB74AB1234');
    expect(findVehicleByPlate([vehicle('v1')], 'wb-74-ab-1234')?.id).toBe('v1');
  });

  /**
   * Two hand-dropped pins on the same doorstep are never bit-identical — these are ~1 m and
   * ~2 m apart, which must read as one place or the address book fills with duplicates of home.
   */
  it('treats coordinates within a few metres as the same place', () => {
    const list = [address('a', { lat: 26.7271, lng: 88.3953 })];

    expect(findAddressAtSamePlace(list, 26.72711, 88.39532)?.id).toBe('a');
    expect(findAddressAtSamePlace(list, 26.727086, 88.395284)?.id).toBe('a');
  });

  it('does not merge genuinely different places', () => {
    const list = [address('a', { lat: 26.7271, lng: 88.3953 })];

    expect(findAddressAtSamePlace(list, 26.7100, 88.4300)).toBeUndefined();
  });
});

// ─── Address use case ───────────────────────────────────────────────────────────────────────

describe('ManageAddressesUseCase', () => {
  it('makes the first saved address the default without being asked', async () => {
    const customers = fakeCustomers();

    const created = await new ManageAddressesUseCase(customers).add('cus_1', {
      label: 'HOME',
      address: '12 Sevoke Road',
      lat: 26.7271,
      lng: 88.3953,
    });

    expect(created.isDefault).toBe(true);
    expect(created.isPreferredPickup).toBe(true);
  });

  it('demotes the old default when a new address claims it', async () => {
    const customers = fakeCustomers({ addresses: [address('a', { isDefault: true })] });

    await new ManageAddressesUseCase(customers).add('cus_1', {
      label: 'OFFICE',
      address: 'Matigara',
      lat: 26.71,
      lng: 88.43,
      isDefault: true,
    });

    expect(customers.addresses.filter((a) => a.isDefault)).toHaveLength(1);
    expect(customers.addresses.find((a) => a.id === 'a')?.isDefault).toBe(false);
  });

  /**
   * Otherwise a customer who deletes their default is left holding addresses with no default,
   * a state the booking flow would have to special-case forever.
   */
  it('promotes a survivor when the default is deleted', async () => {
    const customers = fakeCustomers({
      addresses: [address('a', { isDefault: true, isPreferredPickup: true }), address('b')],
    });

    await new ManageAddressesUseCase(customers).remove('cus_1', 'a');

    expect(customers.addresses).toHaveLength(1);
    expect(customers.addresses[0]?.isDefault).toBe(true);
    expect(customers.addresses[0]?.isPreferredPickup).toBe(true);
  });

  it('reports a missing address rather than silently doing nothing', async () => {
    const customers = fakeCustomers({ addresses: [address('a')] });

    expect(await codeOfRejection(new ManageAddressesUseCase(customers).remove('cus_1', 'nope'))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('ManageVehiclesUseCase', () => {
  it('refuses a duplicate plate, however it was typed', async () => {
    const customers = fakeCustomers({ vehicles: [vehicle('v1', { plateNumber: 'WB74AB1234' })] });

    const code = await codeOfRejection(
      new ManageVehiclesUseCase(customers).add('cus_1', { category: 'SUV', plateNumber: 'wb-74-ab-1234' }),
    );

    expect(code).toBe('CONFLICT');
  });

  it('lets a vehicle keep its own plate on an unrelated edit', async () => {
    const customers = fakeCustomers({ vehicles: [vehicle('v1', { plateNumber: 'WB74AB1234' })] });

    const updated = await new ManageVehiclesUseCase(customers).update('cus_1', 'v1', {
      plateNumber: 'WB74AB1234',
      category: 'SUV',
    });

    expect(updated.category).toBe('SUV');
  });
});

// ─── Save-at-booking upserts ────────────────────────────────────────────────────────────────

describe('UpsertFromBookingUseCase', () => {
  /**
   * The property that makes the booking-time save safe to run on every trip: booking twice from
   * home must leave exactly one saved address.
   */
  it('returns the existing address instead of saving the same place twice', async () => {
    const customers = fakeCustomers({ addresses: [address('a', { lat: 26.7271, lng: 88.3953 })] });

    const id = await new UpsertFromBookingUseCase(customers).upsertAddress('cus_1', {
      label: 'OTHER',
      address: 'a slightly differently worded address',
      lat: 26.72711,
      lng: 88.39532,
    });

    expect(id).toBe('a');
    expect(customers.addresses).toHaveLength(1);
    // The customer's own label survives — the booking flow must not relabel a curated address.
    expect(customers.addresses[0]?.label).toBe('HOME');
  });

  it('adds the preferred-pickup flag to an address it matched, when asked', async () => {
    const customers = fakeCustomers({ addresses: [address('a')] });

    await new UpsertFromBookingUseCase(customers).upsertAddress('cus_1', {
      label: 'HOME',
      address: 'x',
      lat: 26.7271,
      lng: 88.3953,
      isPreferredPickup: true,
    });

    expect(customers.addresses[0]?.isPreferredPickup).toBe(true);
  });

  it('returns the existing vehicle rather than failing on a duplicate plate', async () => {
    const customers = fakeCustomers({ vehicles: [vehicle('v1', { plateNumber: 'WB74AB1234' })] });

    const id = await new UpsertFromBookingUseCase(customers).upsertVehicle('cus_1', {
      category: 'SEDAN',
      plateNumber: 'WB 74 AB 1234',
    });

    // Never a CONFLICT here, unlike the explicit endpoint: a booking must not fail because its
    // optional side effect had nothing new to do.
    expect(id).toBe('v1');
    expect(customers.vehicles).toHaveLength(1);
  });
});

// ─── Driver onboarding gate ─────────────────────────────────────────────────────────────────

describe('missingForSubmission', () => {
  const complete = { fullName: 'Bimal Rai', dob: new Date('1988-07-04'), gender: 'MALE', address: 'Matigara' };

  it('is empty when everything is present', () => {
    expect(missingForSubmission(complete, ['LICENCE', 'AADHAAR'])).toEqual([]);
  });

  /** The list is the response body: "complete your profile" sends a driver hunting blindly. */
  it('names each missing field and document by path', () => {
    const missing = missingForSubmission({ ...complete, dob: null }, ['LICENCE']);

    expect(missing).toEqual(['dob', 'documents.AADHAAR']);
  });

  it('treats a whitespace-only name as missing', () => {
    expect(missingForSubmission({ ...complete, fullName: '   ' }, ['LICENCE', 'AADHAAR'])).toEqual([
      'full_name',
    ]);
  });

  /** Presence, not verification — an admin verifies content at the next step. */
  it('accepts documents that are still PENDING', () => {
    expect(missingForSubmission(complete, ['AADHAAR', 'LICENCE'])).toEqual([]);
  });

  it('ignores documents that are not required', () => {
    expect(missingForSubmission(complete, ['INSURANCE'])).toEqual([
      'documents.LICENCE',
      'documents.AADHAAR',
    ]);
  });
});

describe('onboarding transitions', () => {
  it('lets a rejected driver resubmit, because rejection is not terminal', () => {
    expect(canSubmit('REJECTED')).toBe(true);
    expect(canSubmit('INCOMPLETE')).toBe(true);
  });

  /** Resubmitting from the queue would reset the driver's place in it. */
  it('refuses a resubmission while already under review or approved', () => {
    expect(canSubmit('SUBMITTED')).toBe(false);
    expect(canSubmit('APPROVED')).toBe(false);
  });

  it('only lets an admin act on a submitted application', () => {
    expect(canReview('SUBMITTED')).toBe(true);
    expect(canReview('INCOMPLETE')).toBe(false);
    expect(canReview('APPROVED')).toBe(false);
  });
});

describe('SubmitOnboardingUseCase', () => {
  it('rejects an incomplete profile with the specific list of what is missing', async () => {
    const drivers = fakeDrivers(driverProfile({ dob: null }));
    const useCase = new SubmitOnboardingUseCase(drivers, fakeDocuments([doc()]));

    const err = await useCase.execute('drv_1').catch((e: unknown) => e as AppError);

    expect((err as AppError).code).toBe('VALIDATION_FAILED');
    expect((err as AppError).publicDetails).toEqual({ missing: ['dob', 'documents.AADHAAR'] });
  });

  it('moves a complete profile to SUBMITTED', async () => {
    const drivers = fakeDrivers(driverProfile());
    const documents = fakeDocuments([doc(), doc({ id: 'doc_2', docType: 'AADHAAR' })]);

    const result = await new SubmitOnboardingUseCase(drivers, documents).execute('drv_1');

    expect(result.onboardingStatus).toBe('SUBMITTED');
    expect(drivers.current.onboardingStatus).toBe('SUBMITTED');
  });

  /** A stale reason shown while a fix is under review would tell the driver the wrong story. */
  it('clears a previous rejection reason on resubmission', async () => {
    const drivers = fakeDrivers(
      driverProfile({ onboardingStatus: 'REJECTED', onboardingRejectionReason: 'Blurry licence' }),
    );
    const documents = fakeDocuments([doc(), doc({ id: 'doc_2', docType: 'AADHAAR' })]);

    await new SubmitOnboardingUseCase(drivers, documents).execute('drv_1');

    expect(drivers.current.onboardingRejectionReason).toBeNull();
  });

  it('refuses to resubmit an application already under review', async () => {
    const drivers = fakeDrivers(driverProfile({ onboardingStatus: 'SUBMITTED' }));
    const documents = fakeDocuments([doc(), doc({ id: 'doc_2', docType: 'AADHAAR' })]);

    expect(await codeOfRejection(new SubmitOnboardingUseCase(drivers, documents).execute('drv_1'))).toBe(
      'CONFLICT',
    );
  });
});

// ─── Admin verification ─────────────────────────────────────────────────────────────────────

describe('VerifyDriverUseCase', () => {
  const submitted = (): DriverProfile => driverProfile({ onboardingStatus: 'SUBMITTED' });

  it('flips both the status and the dispatch gate in one approval', async () => {
    const drivers = fakeDrivers(submitted());
    const audit = fakeAudit();

    const result = await new VerifyDriverUseCase(drivers, fakeDocuments(), audit).approve('drv_1', {
      adminId: 'adm_1',
    });

    // Two flags, one action — a driver showing "approved" who cannot go on duty is the failure
    // this guards against.
    expect(result.onboardingStatus).toBe('APPROVED');
    expect(result.isVerified).toBe(true);
  });

  it('records an APPROVE audit entry attributed to the acting admin', async () => {
    const audit = fakeAudit();

    await new VerifyDriverUseCase(fakeDrivers(submitted()), fakeDocuments(), audit).approve('drv_1', {
      adminId: 'adm_1',
      ip: '1.2.3.4',
    });

    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      adminId: 'adm_1',
      entityType: 'Driver',
      entityId: 'drv_1',
      // Not folded into UPDATE: "who approved this driver" must be answerable without decoding
      // the `after` blob.
      action: 'APPROVE',
      ip: '1.2.3.4',
    });
  });

  /** Approving someone who never applied would bypass the completeness gate entirely. */
  it('refuses to approve a driver who has not submitted', async () => {
    const drivers = fakeDrivers(driverProfile({ onboardingStatus: 'INCOMPLETE' }));

    const code = await codeOfRejection(
      new VerifyDriverUseCase(drivers, fakeDocuments(), fakeAudit()).approve('drv_1', { adminId: 'adm_1' }),
    );

    expect(code).toBe('CONFLICT');
  });

  it('stores the reason on a rejection and revokes verification', async () => {
    const drivers = fakeDrivers(submitted());

    const result = await new VerifyDriverUseCase(drivers, fakeDocuments(), fakeAudit()).reject(
      'drv_1',
      'Licence photo is unreadable.',
      { adminId: 'adm_1' },
    );

    expect(result.onboardingStatus).toBe('REJECTED');
    expect(result.isVerified).toBe(false);
    expect(result.onboardingRejectionReason).toBe('Licence photo is unreadable.');
  });

  /** A rejection with no reason sends the driver back to re-upload the same bad photo. */
  it('will not reject a document without saying why', async () => {
    const documents = fakeDocuments([doc()]);

    const code = await codeOfRejection(
      new VerifyDriverUseCase(fakeDrivers(submitted()), documents, fakeAudit()).reviewDocument(
        'doc_1',
        'REJECTED',
        '   ',
        { adminId: 'adm_1' },
      ),
    );

    expect(code).toBe('VALIDATION_FAILED');
  });

  /**
   * Per-document review is independent of the application verdict: a driver can have three
   * verified documents and one rejected, and rejecting one photo must not reject the person.
   */
  it('reviewing one document does not change the driver onboarding status', async () => {
    const drivers = fakeDrivers(submitted());
    const documents = fakeDocuments([doc()]);

    await new VerifyDriverUseCase(drivers, documents, fakeAudit()).reviewDocument(
      'doc_1',
      'REJECTED',
      'Expired at submission.',
      { adminId: 'adm_1' },
    );

    expect(drivers.current.onboardingStatus).toBe('SUBMITTED');
    expect(documents.list[0]?.status).toBe('REJECTED');
  });
});
