'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  DataState,
  Dialog,
  FormField,
  Input,
  Select,
  SkeletonFieldList,
} from '@driverzone/design-system';
import type {
  AdminCustomerDetailDto,
  AdminUpdateCustomerRequest,
  CustomerGender,
} from '@/lib/api/endpoints/customers';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatMobile } from '@/lib/format';
import { useCustomer } from '../hooks/useCustomer';
import { useUpdateCustomer } from '../hooks/useUpdateCustomer';

/**
 * The form's own state. Every field is a string, including the ones that are nullable on the
 * wire — `''` is what an empty text input holds, and mapping it back to `null` happens once, in
 * `buildPatch`, rather than in every onChange.
 */
interface FormState {
  fullName: string;
  dob: string;
  gender: CustomerGender | 'UNSET';
  alternateNumber: string;
  blocked: boolean;
}

const GENDER_OPTIONS = [
  { value: 'UNSET', label: 'Not stated' },
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefers not to say' },
];

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'BLOCKED', label: 'Blocked — cannot book' },
];

/** E.164, matching what the API accepts. The client normalises; the server refuses anything else. */
const E164 = /^\+[1-9]\d{7,14}$/;

function toForm(customer: AdminCustomerDetailDto): FormState {
  return {
    fullName: customer.full_name ?? '',
    dob: customer.dob ?? '',
    gender: customer.gender ?? 'UNSET',
    alternateNumber: customer.alternate_number ?? '',
    blocked: customer.is_blocked,
  };
}

/**
 * Only what actually CHANGED, because the wire format distinguishes "leave this alone" from
 * "clear this" and a form cannot tell them apart on its own.
 *
 * Sending the whole form on every save would work today and be wrong the moment a field is added
 * to the customer's own app that this dialog does not render: the admin's blank copy of it would
 * overwrite the real value on an unrelated edit.
 */
function buildPatch(original: AdminCustomerDetailDto, form: FormState): AdminUpdateCustomerRequest {
  const patch: AdminUpdateCustomerRequest = {};
  const before = toForm(original);

  // `full_name` has no null in its wire type — the API models it as "set it or don't", so a
  // cleared box means "no change", not "erase their name". Erasing a name is not an edit an
  // admin should be able to make by accident with the backspace key.
  if (form.fullName.trim() !== before.fullName && form.fullName.trim() !== '') {
    patch.full_name = form.fullName.trim();
  }

  if (form.dob !== before.dob) patch.dob = form.dob === '' ? null : form.dob;

  if (form.gender !== before.gender) {
    patch.gender = form.gender === 'UNSET' ? null : form.gender;
  }

  if (form.alternateNumber.trim() !== before.alternateNumber) {
    patch.alternate_number = form.alternateNumber.trim() === '' ? null : form.alternateNumber.trim();
  }

  if (form.blocked !== before.blocked) patch.is_blocked = form.blocked;

  return patch;
}

export function CustomerEditDialog({
  customerId,
  onClose,
}: {
  customerId: string | undefined;
  onClose: () => void;
}) {
  const query = useCustomer(customerId);
  const update = useUpdateCustomer();

  const [form, setForm] = useState<FormState | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  /**
   * The form is seeded from the record once it arrives, and re-seeded when a different customer
   * is opened — `query.data` is the dependency, so re-opening the same row after a save starts
   * from the saved values rather than from what was typed last time.
   *
   * Deriving the fields during render instead would make them read-only: every keystroke would
   * be replaced by the server's copy on the next render.
   */
  useEffect(() => {
    setError(undefined);
    setForm(query.data === undefined ? undefined : toForm(query.data));
  }, [query.data]);

  const set = (patch: Partial<FormState>): void => {
    setForm((current) => (current === undefined ? current : { ...current, ...patch }));
  };

  const save = (): void => {
    if (query.data === undefined || form === undefined) return;

    if (form.alternateNumber.trim() !== '' && !E164.test(form.alternateNumber.trim())) {
      setError('Use international format, e.g. +919876543210');
      return;
    }

    const patch = buildPatch(query.data, form);

    // Nothing changed — close rather than sending an empty PATCH. An audit entry recording that
    // an admin changed no fields is noise in the one log that must stay readable.
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    update.mutate({ id: query.data.id, patch }, { onSuccess: () => onClose() });
  };

  return (
    <Dialog
      open={customerId !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Edit customer"
      description="Changes here are recorded against your admin account."
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={save}
            loading={update.isPending}
            disabled={form === undefined}
          >
            Save changes
          </Button>
        </>
      }
    >
      <DataState
        loading={query.isLoading}
        error={query.isError ? toErrorState(query.error, () => void query.refetch()) : undefined}
        skeleton={<SkeletonFieldList rows={5} />}
      >
        {query.data !== undefined && form !== undefined && (
          <div className="flex flex-col gap-4">
            {/*
              The mobile number is shown and not editable. It IS the account — the OTP target and
              the unique key — so changing it is a migration with its own audit story, not a text
              field. Hiding it instead would leave the admin unsure which record they have open.
            */}
            <FormField label="Mobile number" hint="The account identity. Not editable here.">
              {({ id }) => (
                <Input id={id} value={formatMobile(query.data.mobile_number)} disabled readOnly />
              )}
            </FormField>

            <FormField label="Full name">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={form.fullName}
                  aria-describedby={describedBy}
                  maxLength={120}
                  onChange={(e) => set({ fullName: e.target.value })}
                  placeholder="Not stated"
                />
              )}
            </FormField>

            <FormField label="Date of birth">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={form.dob}
                  onChange={(e) => set({ dob: e.target.value })}
                />
              )}
            </FormField>

            <FormField label="Gender">
              {({ id }) => (
                <Select
                  id={id}
                  value={form.gender}
                  onValueChange={(value) => set({ gender: value as FormState['gender'] })}
                  options={GENDER_OPTIONS}
                />
              )}
            </FormField>

            <FormField
              label="Alternate number"
              error={error}
              hint="International format, e.g. +919876543210. Leave empty to clear."
            >
              {({ id, invalid, describedBy }) => (
                <Input
                  id={id}
                  value={form.alternateNumber}
                  invalid={invalid}
                  aria-describedby={describedBy}
                  onChange={(e) => {
                    setError(undefined);
                    set({ alternateNumber: e.target.value });
                  }}
                  placeholder="+919876543210"
                />
              )}
            </FormField>

            <FormField
              label="Account status"
              hint="A blocked customer keeps their record and cannot place bookings."
            >
              {({ id }) => (
                <Select
                  id={id}
                  value={form.blocked ? 'BLOCKED' : 'ACTIVE'}
                  onValueChange={(value) => set({ blocked: value === 'BLOCKED' })}
                  options={STATUS_OPTIONS}
                />
              )}
            </FormField>
          </div>
        )}
      </DataState>
    </Dialog>
  );
}
