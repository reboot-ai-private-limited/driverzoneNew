'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button, Dialog, FormField, Input } from '@driverzone/design-system';
import { accountDeletionApi } from '@/lib/api/endpoints/admins';
import { useSession } from '@/lib/auth/SessionProvider';
import { keys } from '@/lib/query/keys';
import { useApiMutation } from '@/lib/query/mutation';

/** Typed, not clicked. An irreversible action should take more than a second click to reach. */
const CONFIRM_WORD = 'DELETE';

const CONSEQUENCES = [
  'Their name, phone number, addresses, photo and documents are erased. This cannot be undone.',
  'They are signed out everywhere. The same number can sign up again as a new, empty account.',
  'Trips and payments are kept for our records, with no name attached.',
  'Refused if they have an unfinished trip or money is owed either way.',
];

/**
 * "Delete account" on a customer's or driver's detail page — for a deletion request that came in
 * by email and that the admin has already verified themselves.
 *
 * Renders NOTHING for an ordinary admin. The server refuses them regardless (SUPER_ADMIN only);
 * hiding the button just keeps a control they cannot use off their screen.
 *
 * The server may refuse with the reasons the account cannot close yet — an open trip, money owed.
 * That arrives as the error toast, verbatim, and nothing has changed.
 */
export function DeleteAccountButton({
  kind,
  id,
  name,
}: {
  kind: 'customers' | 'drivers';
  id: string;
  name: string;
}) {
  const router = useRouter();
  const { admin } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');

  const remove = useApiMutation<void, unknown>({
    call: (token) => accountDeletionApi.delete(token, kind, id, { reason: reason.trim() }),
    invalidates: [kind === 'customers' ? keys.customers.all() : keys.drivers.all()],
    successMessage: 'Account deleted and personal data erased.',
    onSuccess: () => {
      setOpen(false);
      router.push(`/${kind}`);
    },
  });

  if (admin?.admin_role !== 'SUPER_ADMIN') return null;

  const ready = reason.trim().length >= 3 && typed.trim() === CONFIRM_WORD;

  return (
    <>
      <Button
        size="sm"
        variant="danger"
        icon={<Trash2 aria-hidden className="size-3.5" />}
        onClick={() => {
          setReason('');
          setTyped('');
          setOpen(true);
        }}
      >
        Delete account
      </Button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${name}'s account?`}
        footer={
          <>
            <Button size="sm" onClick={() => setOpen(false)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!ready}
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete account
            </Button>
          </>
        }
      >
        <ul className="flex flex-col gap-1.5 text-sm text-text">
          {CONSEQUENCES.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="text-text-subtle">
                •
              </span>
              {line}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-col gap-4">
          <FormField
            label="Reason"
            hint="Recorded in the audit log, e.g. “Emailed request, confirmed by phone.”"
          >
            {({ id: fieldId, describedBy }) => (
              <Input
                id={fieldId}
                value={reason}
                aria-describedby={describedBy}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </FormField>
          <FormField label={`Type ${CONFIRM_WORD} to confirm`}>
            {({ id: fieldId }) => (
              <Input
                id={fieldId}
                value={typed}
                autoComplete="off"
                onChange={(e) => setTyped(e.target.value)}
              />
            )}
          </FormField>
        </div>
      </Dialog>
    </>
  );
}
