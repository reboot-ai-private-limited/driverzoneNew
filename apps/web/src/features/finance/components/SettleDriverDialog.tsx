'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, FormField, Input, toast } from '@driverzone/design-system';
import type { DriverBalanceRowDto } from '@driverzone/contracts';
import { ApiError } from '@/lib/api/ApiError';
import { formatPaise } from '@/lib/format';
import { useSettleDriver } from '../hooks/useSettleDriver';

/**
 * Records that a driver's balance was cleared.
 *
 * THE ONLY WRITE ON THE FINANCE SCREEN, and it cannot be undone — the ledger is append-only, so a
 * settlement entered wrongly can only be annotated with a correction, never removed. The dialog
 * says so rather than leaving an admin to discover it.
 *
 * The direction is NOT chosen here. The server reads the driver's balance and decides whether
 * this is the driver repaying us or us paying them; this dialog only words the question to match.
 */
export function SettleDriverDialog({
  driver,
  onClose,
}: {
  driver: DriverBalanceRowDto | undefined;
  onClose: () => void;
}) {
  const settle = useSettleDriver(driver?.driver_id ?? '');

  const outstandingPaise =
    driver === undefined ? 0 : Math.abs(driver.balance.amount_paise);
  const repaying = (driver?.balance.amount_paise ?? 0) < 0;

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');

  /*
   * ONE KEY PER OPENING, not per click. That is the whole mechanism: a stable key means a second
   * submit of the same dialog is recognised as the same settlement and writes nothing, while a
   * key regenerated per attempt would make every retry a fresh row.
   *
   * `driver_id` is in the dependency list so reopening on a different driver mints a new key.
   */
  const idempotencyKey = useMemo(
    () => `settle-${driver?.driver_id ?? 'none'}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    [driver?.driver_id],
  );

  // Defaults to the full outstanding amount, which is the common case — clearing the balance.
  useEffect(() => {
    if (driver !== undefined) {
      setAmount(String(outstandingPaise / 100));
      setNote('');
      setReference('');
    }
  }, [driver, outstandingPaise]);

  const amountPaise = Math.round(Number(amount) * 100);
  const amountValid =
    Number.isFinite(amountPaise) && amountPaise > 0 && amountPaise <= outstandingPaise;
  const canSubmit = amountValid && note.trim() !== '' && !settle.isPending;

  async function submit() {
    if (!canSubmit) return;
    try {
      const receipt = await settle.mutateAsync({
        amount_paise: amountPaise,
        note: note.trim(),
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        idempotencyKey,
      });
      toast.success(
        `Recorded ${receipt.amount.amount_display} — balance is now ${receipt.balance_after.amount_display}`,
      );
      onClose();
    } catch (error) {
      // The server's message is the useful one here: it names the cap it applied, recomputed at
      // the moment of the write rather than when this dialog was opened.
      toast.error(
        error instanceof ApiError ? error.message : 'Could not record the settlement.',
        error instanceof ApiError ? error.requestId : undefined,
      );
    }
  }

  return (
    <Dialog
      open={driver !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={repaying ? 'Record a payment from the driver' : 'Record a payout to the driver'}
      {...(driver === undefined
        ? {}
        : {
            description: repaying
              ? `${driver.name ?? 'This driver'} is holding ${driver.owed_to_company.amount_display} of company money.`
              : `The company owes ${driver.name ?? 'this driver'} ${driver.payable_to_driver.amount_display}.`,
          })}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={settle.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={settle.isPending} disabled={!canSubmit}>
            {repaying ? 'Record payment' : 'Record payout'}
          </Button>
        </div>
      }
    >
      {driver !== undefined && (
        <div className="flex flex-col gap-4">
          <FormField
            label="Amount (₹)"
            required
            hint={`At most ${formatPaise(outstandingPaise)} — the outstanding balance.`}
            error={
              amount !== '' && !amountValid
                ? `Enter an amount between ₹1 and ${formatPaise(outstandingPaise)}.`
                : undefined
            }
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

          <FormField
            label="Note"
            required
            hint="What this was — where the cash was handed over, who took it."
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Cash handed in at the Siliguri office"
              />
            )}
          </FormField>

          <FormField label="Reference" hint="A UTR or receipt number, if there is one.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Optional"
              />
            )}
          </FormField>

          <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text-subtle">
            The ledger is append-only. A settlement recorded here cannot be deleted — a mistake can
            only be corrected by a later adjustment, and both will stay visible.
          </p>
        </div>
      )}
    </Dialog>
  );
}
