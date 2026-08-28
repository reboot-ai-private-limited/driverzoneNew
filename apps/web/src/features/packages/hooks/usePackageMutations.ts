'use client';

import type {
  CreateIncityPackageRequest,
  CreateOutstationPackageRequest,
  IncityPackageDto,
  OutstationPackageDto,
  UpdateIncityPackageRequest,
  UpdateOutstationPackageRequest,
} from '@driverzone/contracts';
import { packagesApi } from '@/lib/api/endpoints/packages';
import { keys } from '@/lib/query/keys';
import { useApiMutation } from '@/lib/query/mutation';

/**
 * The writes. All four invalidate `keys.packages.all()` rather than a narrower key, because the
 * outstation coverage ladder is DERIVED from the list: a saved band that leaves the ladder stale
 * shows a gap that no longer exists, or hides one that now does, and that ladder is the only
 * thing standing between ops and a distance nobody priced.
 *
 * NO OPTIMISTIC UPDATES here, per §5 of docs/engineering/frontend-architecture.md: this is money.
 * A fare that flashes to one number and corrects itself to another leaves the admin unable to say
 * which of the two was real.
 */

export function useCreateIncityPackage(onSaved?: (pkg: IncityPackageDto) => void) {
  return useApiMutation<CreateIncityPackageRequest, IncityPackageDto>({
    call: (token, body, idempotencyKey) => packagesApi.createIncity(token, body, idempotencyKey),
    invalidates: [keys.packages.all()],
    successMessage: 'Package created.',
    ...(onSaved === undefined ? {} : { onSuccess: onSaved }),
  });
}

export function useUpdateIncityPackage(id: string, onSaved?: (pkg: IncityPackageDto) => void) {
  return useApiMutation<UpdateIncityPackageRequest, IncityPackageDto>({
    call: (token, body) => packagesApi.updateIncity(token, id, body),
    invalidates: [keys.packages.all()],
    successMessage: 'Package saved.',
    ...(onSaved === undefined ? {} : { onSuccess: onSaved }),
  });
}

export function useCreateOutstationPackage(onSaved?: (pkg: OutstationPackageDto) => void) {
  return useApiMutation<CreateOutstationPackageRequest, OutstationPackageDto>({
    call: (token, body, idempotencyKey) =>
      packagesApi.createOutstation(token, body, idempotencyKey),
    invalidates: [keys.packages.all()],
    successMessage: 'Band created.',
    ...(onSaved === undefined ? {} : { onSuccess: onSaved }),
  });
}

export function useUpdateOutstationPackage(
  id: string,
  onSaved?: (pkg: OutstationPackageDto) => void,
) {
  return useApiMutation<UpdateOutstationPackageRequest, OutstationPackageDto>({
    call: (token, body) => packagesApi.updateOutstation(token, id, body),
    invalidates: [keys.packages.all()],
    successMessage: 'Band saved.',
    ...(onSaved === undefined ? {} : { onSuccess: onSaved }),
  });
}
