'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, FormField, Input, Select, toast } from '@driverzone/design-system';
import type { GrantWalletCreditRequest, Money } from '@driverzone/contracts';
import { ApiError } from '@/lib/api/ApiError';
import { useGrantWalletCredit } from '../hooks/useCustomerWallets';

/** The three an admin may write. The rest of `WalletEntryType` is the system's to author. */
const ENTRY_TYPES = [
  { value: 'CREDIT_GRANT', label: 'Credit (goodwill, refund)' },
  { value: 'FINE', label: 'Fine (charge the customer)' },
  { value: 'ADJUSTMENT', label: 'Adjustment (correction)' },
] as const;

type EntryType = (typeof ENTRY_TYPES)[number]['value'];

/**
 * Puts credit on a customer's wallet, charges a fine, or corrects a mistake.
 *
 * THE SIGN IS DERIVED FROM THE TYPE, not typed by the admin. `CREDIT_GRANT` is money toward the
 * customer and `FINE` is money away from them; asking someone to also get a minus sign right
 * would make the same mistake possible twice. `ADJUSTMENT` is the exception — it exists precisely
 * to go either way — so it is the only one that offers the choice.
 *
 * Like the driver ledger, the customer wallet is append-only: this can add a correcting row but
 * never remove the row being corrected.
 */
/**
 * What the dialog needs to know about its subject, structurally.
 *
 * NOT `CustomerWalletRowDto`, which is a Finance-tab row and carries a phone, an entry count and
 * a last-activity date this dialog never reads. The customer detail page has a wallet but no such
 * row, and widening the prop to what is actually used lets both callers pass what they already
 * have instead of one of them assembling a fake row to satisfy a type.
 */
export interface GrantCreditTarget {
  customer_id: string;
  name: string | null;
  balance: Money;
}

export function GrantCreditDialog({
  customer,
  onClose,
}: {
  customer: GrantCreditTarget | undefined;
  onClose: () => void;
}) {
  const grant = useGrantWalletCredit(customer?.customer_id ?? '');

  const [entryType, setEntryType] = useState<EntryType>('CREDIT_GRANT');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  /** Only meaningful for `ADJUSTMENT`, the one type that can go either way. */
  const [adjustmentDirection, setAdjustmentDirection] = useState<'ADD' | 'DEDUCT'>('ADD');

  useEffect(() => {
    if (customer !== undefined) {
      setEntryType('CREDIT_GRANT');
      setAmount('');
      setNote('');
      setAdjustmentDirection('ADD');
    }
  }, [customer]);

  const magnitudePaise = Math.round(Number(amount) * 100);
  const amountValid = Number.isFinite(magnitudePaise) && magnitudePaise > 0;
  const canSubmit = amountValid && note.trim() !== '' && !grant.isPending;

  /** `FINE` always deducts; `CREDIT_GRANT` always adds; `ADJUSTMENT` follows the chosen way. */
  function signedAmount(): number {
    if (entryType === 'FINE') return -magnitudePaise;
    if (entryType === 'ADJUSTMENT' && adjustmentDirection === 'DEDUCT') return -magnitudePaise;
    return magnitudePaise;
  }

  async function submit() {
    if (!canSubmit) return;
    const body: GrantWalletCreditRequest = {
      entry_type: entryType,
      amount_paise: signedAmount(),
      note: note.trim(),
    };

    try {
      const wallet = await grant.mutateAsync(body);
      toast.success(`Wallet updated — balance is now ${wallet.balance.amount_display}`);
      onClose();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not update the wallet.',
        error instanceof ApiError ? error.requestId : undefined,
      );
    }
  }

  return (
    <Dialog
      open={customer !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Adjust customer wallet"
      {...(customer === undefined
        ? {}
        : {
            description: `${customer.name ?? 'This customer'} currently holds ${customer.balance.amount_display}.`,
          })}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={grant.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={grant.isPending}
            disabled={!canSubmit}
          >
            Apply
          </Button>
        </div>
      }
    >
      {customer !== undefined && (
        <div className="flex flex-col gap-4">
          <FormField label="What is this?" required>
            {({ id }) => (
              <Select
                id={id}
                value={entryType}
                onValueChange={(value) => setEntryType(value as EntryType)}
                options={[...ENTRY_TYPES]}
                />
            )}
          </FormField>

          {entryType === 'ADJUSTMENT' && (
            <FormField
              label="Direction"
              required
              hint="An adjustment is the one entry that can go either way."
            >
              {({ id }) => (
                <Select
                  id={id}
                  value={adjustmentDirection}
                  onValueChange={(value) => setAdjustmentDirection(value as 'ADD' | 'DEDUCT')}
                  options={[
                  { value: 'ADD', label: 'Add to their balance' },
                  { value: 'DEDUCT', label: 'Deduct from their balance' },
                  ]}
                  />
              )}
            </FormField>
          )}

          <FormField
            label="Amount (₹)"
            required
            hint={
              entryType === 'FINE'
                ? 'Charged to the customer — it comes off their balance.'
                : entryType === 'CREDIT_GRANT'
                  ? 'Added to their balance, spendable against a future fare.'
                  : 'Applied in the direction chosen above.'
            }
            error={amount !== '' && !amountValid ? 'Enter an amount greater than zero.' : undefined}
          >
            {({ id, invalid, describedBy }) => (
              <Input
                id={id}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            )}
          </FormField>

          <FormField label="Note" required hint="Mandatory — the server rejects a blank one.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Goodwill credit after a cancelled trip"
              />
            )}
          </FormField>

          <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text-subtle">
            The wallet is append-only. This adds a row and cannot remove one — a mistake is fixed
            with a further adjustment, and both stay visible.
          </p>
        </div>
      )}
    </Dialog>
  );
}
