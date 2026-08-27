'use client';

import type { ReactNode } from 'react';
import {
  Badge,
  Button,
  DataState,
  DefinitionList,
  Dialog,
  FieldRow,
  SkeletonFieldList,
} from '@driverzone/design-system';
import type { AdminCustomerDetailDto } from '@/lib/api/endpoints/customers';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatDate, formatMobile } from '@/lib/format';
import { useCustomer } from '../hooks/useCustomer';

const GENDER_LABELS: Record<string, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
  PREFER_NOT_TO_SAY: 'Prefers not to say',
};

/**
 * The View action. A dialog, not a route.
 *
 * A `/customers/[id]` page would be the right call once there is a booking history, a wallet and
 * a support timeline to show — that is a screen. What exists today is thirty fields, and putting
 * thirty fields behind a navigation costs the admin the list position they were reading.
 * Promoting this to a page later changes this file and nothing that uses it.
 */
export function CustomerViewDialog({
  customerId,
  onClose,
  onEdit,
}: {
  /** `undefined` closes the dialog. The query is disabled in that state, not merely hidden. */
  customerId: string | undefined;
  onClose: () => void;
  onEdit: (id: string) => void;
}) {
  const query = useCustomer(customerId);

  return (
    <Dialog
      open={customerId !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Customer"
      className="max-w-2xl"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            size="sm"
            variant="primary"
            // Disabled until the record is loaded: editing what you have not been shown is how
            // an admin overwrites a field they never saw.
            disabled={query.data === undefined}
            onClick={() => {
              if (customerId !== undefined) onEdit(customerId);
            }}
          >
            Edit
          </Button>
        </>
      }
    >
      <DataState
        loading={query.isLoading}
        error={query.isError ? toErrorState(query.error, () => void query.refetch()) : undefined}
        skeleton={<SkeletonFieldList rows={8} />}
      >
        {query.data !== undefined && <CustomerFields customer={query.data} />}
      </DataState>
    </Dialog>
  );
}

function CustomerFields({ customer }: { customer: AdminCustomerDetailDto }) {
  return (
    <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
      <DefinitionList>
        <FieldRow label="Name">{customer.full_name ?? <Unset />}</FieldRow>
        <FieldRow label="Mobile">
          <span className="tnum">{formatMobile(customer.mobile_number)}</span>
        </FieldRow>
        <FieldRow label="Alternate">
          {customer.alternate_number === null ? (
            <Unset />
          ) : (
            <span className="tnum">{formatMobile(customer.alternate_number)}</span>
          )}
        </FieldRow>
        <FieldRow label="Gender">
          {customer.gender === null ? (
            <Unset />
          ) : (
            (GENDER_LABELS[customer.gender] ?? customer.gender)
          )}
        </FieldRow>
        {/* `dob` is a date-only string, so it is shown as stored rather than passed through
            `formatDate`, which would put it in a timezone a birthday does not have. */}
        <FieldRow label="Date of birth">{customer.dob ?? <Unset />}</FieldRow>
        <FieldRow label="Joined">{formatDate(customer.joined_at)}</FieldRow>
        <FieldRow label="Status">
          <Badge tone={customer.is_blocked ? 'danger' : 'success'}>
            {customer.is_blocked ? 'Blocked' : 'Active'}
          </Badge>
        </FieldRow>
        <FieldRow label="Last ride">
          {customer.last_ride_at === null ? <NotYetTracked /> : formatDate(customer.last_ride_at)}
        </FieldRow>
        <FieldRow label="Rating">
          {customer.rating === null ? <NotYetTracked /> : `${customer.rating.toFixed(1)} / 5`}
        </FieldRow>
        <FieldRow label="Languages">
          {customer.languages_known.length === 0 ? <Unset /> : customer.languages_known.join(', ')}
        </FieldRow>
        <FieldRow label="Emergency contact">
          {customer.emergency_contact === null ? (
            <Unset />
          ) : (
            `${customer.emergency_contact.name} · ${formatMobile(customer.emergency_contact.number)}`
          )}
        </FieldRow>
      </DefinitionList>

      <Section title="Vehicles" emptyLabel="No vehicles saved.">
        {customer.vehicles.map((vehicle) => (
          <li key={vehicle.id} className="flex items-baseline justify-between gap-4 py-2">
            <span className="text-sm text-text tnum">{vehicle.plate_number}</span>
            <span className="text-xs text-text-subtle text-right">
              {[vehicle.category, vehicle.fuel_type, vehicle.is_default ? 'Default' : undefined]
                .filter((part) => part !== null && part !== undefined)
                .join(' · ')}
            </span>
          </li>
        ))}
      </Section>

      <Section title="Saved addresses" emptyLabel="No addresses saved.">
        {customer.saved_addresses.map((address) => (
          <li key={address.id} className="flex items-baseline justify-between gap-4 py-2">
            <span className="text-sm text-text">{address.address}</span>
            <span className="text-xs text-text-subtle text-right shrink-0">
              {[
                address.label,
                address.is_preferred_pickup ? 'Preferred pickup' : undefined,
                address.is_default ? 'Default' : undefined,
              ]
                .filter((part) => part !== undefined)
                .join(' · ')}
            </span>
          </li>
        ))}
      </Section>
    </div>
  );
}

/**
 * A list section that says so when it is empty.
 *
 * `children.length === 0` rather than a separate `items` prop, because the empty case is the
 * common one here — most customers have saved neither a car nor an address — and a heading
 * followed by nothing reads as a rendering bug.
 */
function Section({
  title,
  emptyLabel,
  children,
}: {
  title: string;
  emptyLabel: string;
  children: ReactNode[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold text-text">{title}</h3>
      {children.length === 0 ? (
        <p className="text-xs text-text-subtle py-2">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-border">{children}</ul>
      )}
    </div>
  );
}

/** A field the customer has not filled in. Profiles complete progressively; this is normal. */
function Unset() {
  return <span className="text-text-subtle">—</span>;
}

/**
 * Distinct from `Unset` on purpose. An empty "Last ride" means the bookings module does not
 * exist yet, not that this customer has never ridden — and an admin should not read the second
 * from the first.
 */
function NotYetTracked() {
  return <span className="text-text-subtle italic">Not tracked yet</span>;
}
