'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, FormField, Input, Select } from '@driverzone/design-system';
import type { AdminRole, AdminUserDto } from '@driverzone/contracts';
import { formatMobile } from '@/lib/format';
import { useCreateAdmin, useUpdateAdmin } from '../hooks/useAdmins';

/** E.164, matching what the API accepts. The client normalises; the server refuses anything else. */
const E164 = /^\+[1-9]\d{7,14}$/;

export const ROLE_OPTIONS: { value: AdminRole; label: string }[] = [
  { value: 'ADMIN', label: 'Admin — runs operations' },
  { value: 'SUPER_ADMIN', label: 'Super admin — also manages admins and deletes accounts' },
];

/**
 * Add an admin, or edit one's name and role.
 *
 * `editing === undefined` and `open` is the ADD form; an `AdminUserDto` is the edit form. The
 * number is not editable once added: it is the credential, and giving someone a different number
 * is adding a different admin.
 */
export function AdminFormDialog({
  open,
  editing,
  selfId,
  onClose,
}: {
  open: boolean;
  editing: AdminUserDto | undefined;
  /** The signed-in admin. Their own role is shown but not editable — the server refuses it anyway. */
  selfId: string | undefined;
  onClose: () => void;
}) {
  const create = useCreateAdmin();
  const update = useUpdateAdmin();

  const [mobile, setMobile] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<AdminRole>('ADMIN');
  const [error, setError] = useState<string | undefined>(undefined);

  // Re-seeded every time the dialog opens, so an edit never starts from the last row's values.
  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setMobile(editing?.mobile_number ?? '+91');
    setFullName(editing?.full_name ?? '');
    setRole(editing?.admin_role ?? 'ADMIN');
  }, [open, editing]);

  const pending = create.isPending || update.isPending;
  const editingSelf = editing !== undefined && editing.id === selfId;

  const save = (): void => {
    const name = fullName.trim();
    if (name === '') {
      setError('Enter their name.');
      return;
    }

    if (editing === undefined) {
      if (!E164.test(mobile.trim())) {
        setError('Use international format, e.g. +919876543210');
        return;
      }
      create.mutate(
        { mobile_number: mobile.trim(), full_name: name, admin_role: role },
        { onSuccess: () => onClose() },
      );
      return;
    }

    const patch = {
      ...(name !== editing.full_name ? { full_name: name } : {}),
      ...(role !== editing.admin_role ? { admin_role: role } : {}),
    };
    // Nothing changed — close rather than write an audit row recording no change.
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    update.mutate({ id: editing.id, patch }, { onSuccess: () => onClose() });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={editing === undefined ? 'Add admin' : 'Edit admin'}
      description={
        editing === undefined
          ? 'They sign in with an OTP sent to this number. Nothing is sent until they try.'
          : 'Changes here are recorded against your admin account.'
      }
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={save} loading={pending}>
            {editing === undefined ? 'Add admin' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField
          label="Mobile number"
          hint={editing === undefined ? 'International format, e.g. +919876543210' : 'The sign-in number. Not editable.'}
          error={editing === undefined ? error : undefined}
        >
          {({ id, invalid, describedBy }) =>
            editing === undefined ? (
              <Input
                id={id}
                value={mobile}
                invalid={invalid}
                aria-describedby={describedBy}
                inputMode="tel"
                onChange={(e) => {
                  setError(undefined);
                  setMobile(e.target.value);
                }}
                placeholder="+919876543210"
              />
            ) : (
              <Input id={id} value={formatMobile(editing.mobile_number)} disabled readOnly />
            )
          }
        </FormField>

        <FormField label="Full name" error={editing === undefined ? undefined : error}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              value={fullName}
              aria-describedby={describedBy}
              maxLength={120}
              onChange={(e) => {
                setError(undefined);
                setFullName(e.target.value);
              }}
            />
          )}
        </FormField>

        <FormField
          label="Role"
          hint={editingSelf ? 'You cannot change your own role. Ask another super admin.' : undefined}
        >
          {({ id }) => (
            <Select
              id={id}
              value={role}
              disabled={editingSelf}
              onValueChange={(value) => setRole(value as AdminRole)}
              options={ROLE_OPTIONS}
            />
          )}
        </FormField>
      </div>
    </Dialog>
  );
}
