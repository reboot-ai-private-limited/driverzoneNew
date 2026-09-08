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
  toast,
} from '@driverzone/design-system';
import {
  type AdminDriverDetailsDto,
  type AdminUpdateDriverRequest,
  type Gender,
  type VehicleTypePreference,
  type CarCategory,
  CAR_CATEGORIES,
  CAR_CATEGORY_LABELS,
  VEHICLE_TYPE_PREFERENCES,
  VEHICLE_TYPE_LABELS,
} from '@driverzone/contracts';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatMobile } from '@/lib/format';
import { useDriverDetails, useUpdateDriver } from '../hooks/useDriverDetails';

interface FormState {
  fullName: string;
  dob: string;
  gender: Gender | 'UNSET';
  experienceYears: string;
  alternateNumber: string;
  emergencyName: string;
  emergencyNumber: string;
  address: string;
  vehicleTypes: VehicleTypePreference[];
  vehicleCategories: CarCategory[];
  canDriveHill: boolean;
}

const GENDER_OPTIONS = [
  { value: 'UNSET', label: 'Not stated' },
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefers not to say' },
];

function toForm(driver: AdminDriverDetailsDto): FormState {
  const p = driver?.profile;
  if (!p) {
    return {
      fullName: '',
      dob: '',
      gender: 'UNSET',
      experienceYears: '',
      alternateNumber: '',
      emergencyName: '',
      emergencyNumber: '',
      address: '',
      vehicleTypes: [],
      vehicleCategories: [],
      canDriveHill: false,
    };
  }
  return {
    fullName: p.full_name ?? '',
    dob: p.dob ?? '',
    gender: p.gender ?? 'UNSET',
    experienceYears: p.experience_years !== null && p.experience_years !== undefined ? String(p.experience_years) : '',
    alternateNumber: p.alternate_number ?? '',
    emergencyName: p.emergency_contact?.name ?? '',
    emergencyNumber: p.emergency_contact?.number ?? '',
    address: p.address ?? '',
    vehicleTypes: p.vehicle_type_preferences ?? [],
    vehicleCategories: p.vehicle_category_preference ?? [],
    canDriveHill: Boolean(p.can_drive_hill),
  };
}

function buildPatch(original: AdminDriverDetailsDto, form: FormState): AdminUpdateDriverRequest {
  const patch: AdminUpdateDriverRequest = {};
  if (!original?.profile) return patch;
  const before = toForm(original);

  if (form.fullName.trim() !== before.fullName && form.fullName.trim() !== '') {
    patch.full_name = form.fullName.trim();
  }

  if (form.dob !== before.dob) {
    patch.dob = form.dob === '' ? null : form.dob;
  }

  if (form.gender !== before.gender) {
    patch.gender = form.gender === 'UNSET' ? null : form.gender;
  }

  if (form.experienceYears !== before.experienceYears) {
    patch.experience_years = form.experienceYears.trim() === '' ? null : Number(form.experienceYears.trim());
  }

  if (form.alternateNumber.trim() !== before.alternateNumber) {
    patch.alternate_number = form.alternateNumber.trim() === '' ? null : form.alternateNumber.trim();
  }

  const emNameChanged = form.emergencyName.trim() !== before.emergencyName;
  const emNumberChanged = form.emergencyNumber.trim() !== before.emergencyNumber;
  if (emNameChanged || emNumberChanged) {
    if (form.emergencyName.trim() === '' && form.emergencyNumber.trim() === '') {
      patch.emergency_contact = null;
    } else {
      patch.emergency_contact = {
        name: form.emergencyName.trim(),
        number: form.emergencyNumber.trim(),
      };
    }
  }

  if (form.address.trim() !== before.address) {
    patch.address = form.address.trim() === '' ? null : form.address.trim();
  }

  if (JSON.stringify(form.vehicleTypes) !== JSON.stringify(before.vehicleTypes)) {
    patch.vehicle_type_preferences = form.vehicleTypes;
  }

  if (JSON.stringify(form.vehicleCategories) !== JSON.stringify(before.vehicleCategories)) {
    patch.vehicle_category_preference = form.vehicleCategories;
  }

  if (form.canDriveHill !== before.canDriveHill) {
    patch.can_drive_hill = form.canDriveHill;
  }

  return patch;
}

export function DriverEditDialog({
  driverId,
  onClose,
}: {
  driverId: string | undefined;
  onClose: () => void;
}) {
  const open = driverId !== undefined;
  const id = driverId ?? '';

  const details = useDriverDetails(driverId);
  const update = useUpdateDriver(id);

  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (details.data?.profile) {
      setForm(toForm(details.data));
    } else {
      setForm(null);
    }
  }, [details.data]);

  const original = details.data?.profile ? details.data : null;
  const patch = original && form ? buildPatch(original, form) : {};
  const isDirty = Object.keys(patch).length > 0;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isDirty) return;

    try {
      await update.mutateAsync(patch);
      toast.success('Driver updated successfully');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update driver');
    }
  };

  const toggleVehicleType = (type: VehicleTypePreference) => {
    if (!form) return;
    const exists = form.vehicleTypes.includes(type);
    setForm({
      ...form,
      vehicleTypes: exists
        ? form.vehicleTypes.filter((t) => t !== type)
        : [...form.vehicleTypes, type],
    });
  };

  const toggleVehicleCategory = (cat: CarCategory) => {
    if (!form) return;
    const exists = form.vehicleCategories.includes(cat);
    setForm({
      ...form,
      vehicleCategories: exists
        ? form.vehicleCategories.filter((c) => c !== cat)
        : [...form.vehicleCategories, cat],
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={details.data?.profile?.full_name ? `Edit ${details.data.profile.full_name}` : 'Edit Driver'}
      description="Update personal information and vehicle preferences."
      className="max-w-xl max-h-[90vh] overflow-y-auto"
      footer={
        <div className="flex justify-end gap-2 w-full">
          <Button type="button" variant="secondary" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!isDirty}
            loading={update.isPending}
            onClick={() => void handleSubmit()}
          >
            Save Changes
          </Button>
        </div>
      }
    >
      <DataState
        loading={details.isLoading}
        skeleton={<SkeletonFieldList rows={6} />}
        error={details.isError ? toErrorState(details.error, () => void details.refetch()) : undefined}
      >
        {form && details.data?.profile && (
          <div className="space-y-4 py-2">
            <FormField label="Full Name" required>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  placeholder="Driver's full name"
                  required
                />
              )}
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Mobile Number">
                {({ id }) => (
                  <Input
                    id={id}
                    value={formatMobile(details.data.profile.mobile_number)}
                    disabled
                    readOnly
                    className="bg-surface-muted text-text-subtle"
                  />
                )}
              </FormField>

              <FormField label="Alternate Mobile">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={form.alternateNumber}
                    onChange={(e) => setForm({ ...form, alternateNumber: e.target.value })}
                    placeholder="Alternate phone number"
                  />
                )}
              </FormField>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField label="Date of Birth">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="date"
                    value={form.dob}
                    onChange={(e) => setForm({ ...form, dob: e.target.value })}
                  />
                )}
              </FormField>

              <FormField label="Gender">
                {({ id }) => (
                  <Select
                    id={id}
                    value={form.gender}
                    onValueChange={(val) => setForm({ ...form, gender: val as Gender | 'UNSET' })}
                    options={GENDER_OPTIONS}
                  />
                )}
              </FormField>

              <FormField label="Experience (Years)">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="number"
                    min={0}
                    max={70}
                    value={form.experienceYears}
                    onChange={(e) => setForm({ ...form, experienceYears: e.target.value })}
                    placeholder="e.g. 5"
                  />
                )}
              </FormField>
            </div>

            <FormField label="Address">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="City, State, Pincode"
                />
              )}
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Emergency Contact Name">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={form.emergencyName}
                    onChange={(e) => setForm({ ...form, emergencyName: e.target.value })}
                    placeholder="Contact person name"
                  />
                )}
              </FormField>

              <FormField label="Emergency Contact Phone">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={form.emergencyNumber}
                    onChange={(e) => setForm({ ...form, emergencyNumber: e.target.value })}
                    placeholder="Contact phone number"
                  />
                )}
              </FormField>
            </div>

            <div className="border-t border-border pt-3 space-y-3">
              <h4 className="text-sm font-semibold text-text">Driving Preferences</h4>

              <div>
                <span className="block text-xs font-medium text-text-subtle mb-1.5">Transmission / Vehicle Types</span>
                <div className="flex flex-wrap gap-2">
                  {VEHICLE_TYPE_PREFERENCES.map((type) => {
                    const active = form.vehicleTypes.includes(type);
                    return (
                      <button
                        type="button"
                        key={type}
                        onClick={() => toggleVehicleType(type)}
                        className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                          active
                            ? 'bg-accent text-accent-ink border-transparent font-medium hover:bg-accent-hover'
                            : 'bg-surface border-border text-text hover:border-border-strong'
                        }`}
                      >
                        {VEHICLE_TYPE_LABELS[type] || type}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-text-subtle mb-1.5">Car Categories</span>
                <div className="flex flex-wrap gap-2">
                  {CAR_CATEGORIES.map((cat) => {
                    const active = form.vehicleCategories.includes(cat);
                    return (
                      <button
                        type="button"
                        key={cat}
                        onClick={() => toggleVehicleCategory(cat)}
                        className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                          active
                            ? 'bg-accent text-accent-ink border-transparent font-medium hover:bg-accent-hover'
                            : 'bg-surface border-border text-text hover:border-border-strong'
                        }`}
                      >
                        {CAR_CATEGORY_LABELS[cat] || cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="can-drive-hill"
                  checked={form.canDriveHill}
                  onChange={(e) => setForm({ ...form, canDriveHill: e.target.checked })}
                  className="size-4 rounded border-border-strong text-interactive focus:ring-interactive"
                />
                <label htmlFor="can-drive-hill" className="text-sm font-medium text-text cursor-pointer">
                  Eligible for hill driving (Declared)
                </label>
              </div>
            </div>
          </div>
        )}
      </DataState>
    </Dialog>
  );
}
