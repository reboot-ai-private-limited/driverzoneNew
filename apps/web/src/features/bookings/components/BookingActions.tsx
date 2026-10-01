'use client';

import { useState } from 'react';
import { Ban, UserCog } from 'lucide-react';
import { Badge, Button, Dialog, Input } from '@driverzone/design-system';
import type { BookingDto } from '@driverzone/contracts';
import { DRIVER_PICKER_DEBOUNCE_MS } from '@/lib/hooks/timing';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import {
  DRIVER_SEARCH_MIN_CHARS,
  useAssignDriver,
  useAssignableDrivers,
  useCancelBooking,
} from '../hooks/useBookings';
import { groupOf } from '../lib/status';
import {
  buildAssignPayload,
  canTransfer,
  isTransferSubmitDisabled,
  transferDialogCopy,
} from '../lib/transfer';

/**
 * The two things ops can actually DO to a live booking, on its own details page.
 *
 * Both are hidden rather than disabled on a booking they cannot apply to — a terminal trip has no
 * ops action left, and a row of permanently greyed buttons is a page telling an admin about
 * capabilities they will never have here.
 */
export function BookingActions({ booking }: { booking: BookingDto }) {
  const [cancelling, setCancelling] = useState(false);
  const [transferring, setTransferring] = useState(false);

  if (FINISHED_GROUPS.has(groupOf(booking.status))) return null;

  return (
    <div className="flex items-center gap-2 print:hidden">
      {/*
        TRANSFER IS OFFERED ONLY WHERE IT IS POSSIBLE. A started trip cannot be reassigned — that
        is a cancellation plus a new booking, and the server refuses it — and a trip still being
        searched for has nobody to move it from, though it CAN be assigned directly.
      */}
      {canTransfer(booking.status) && (
        <Button
          size="sm"
          icon={<UserCog aria-hidden className="size-3.5" />}
          onClick={() => setTransferring(true)}
        >
          {booking.driver === null ? 'Assign a driver' : 'Transfer driver'}
        </Button>
      )}

      <Button
        size="sm"
        icon={<Ban aria-hidden className="size-3.5" />}
        onClick={() => setCancelling(true)}
      >
        Cancel booking
      </Button>

      <CancelDialog booking={booking} open={cancelling} onOpenChange={setCancelling} />
      <TransferDialog booking={booking} open={transferring} onOpenChange={setTransferring} />
    </div>
  );
}

/** Groups where the trip is over. Nothing ops does here applies any more. */
const FINISHED_GROUPS = new Set<ReturnType<typeof groupOf>>(['COMPLETED', 'CANCELLED', 'EXPIRED']);

function CancelDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: BookingDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const cancel = useCancelBooking();

  const submit = () => {
    cancel.mutate(
      { id: booking.id, reason: reason.trim() },
      {
        onSuccess: () => {
          onOpenChange(false);
          setReason('');
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Cancel ${booking.reference}`}
      description="Nobody is charged, and the driver keeps a clean record."
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Keep booking
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={submit}
            disabled={reason.trim().length === 0 || cancel.isPending}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel booking'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        {/*
          MANDATORY, and it reaches both parties verbatim. A trip that vanishes with no explanation
          is a support call from the customer and a second one from the driver — exactly the work
          ops was trying to save.
        */}
        <label className="text-xs font-medium text-text-muted" htmlFor="cancel-reason">
          Reason — the customer and the driver both see this
        </label>
        <Input
          id="cancel-reason"
          value={reason}
          maxLength={500}
          placeholder="No driver available in the area"
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </Dialog>
  );
}

function TransferDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: BookingDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  /**
   * `typed` is what the admin is typing; `search` is what is actually asked for, lagging by
   * `DRIVER_PICKER_DEBOUNCE_MS`.
   *
   * THE INPUT MUST BE DRIVEN BY `typed`, never by the debounced value — binding it to the lagging
   * one makes the field drop characters under a fast typist. The same split every other search in
   * the panel uses (`DriversScreen`, `CustomersScreen`, the finance tabs).
   *
   * WHY IT MATTERS HERE. The query is keyed on the search term, so eight keystrokes were eight
   * DIFFERENT keys — and TanStack's de-duplication only collapses concurrent requests for the SAME
   * key, so it collapsed none of them. Typing "Ramesh" put six name-regex searches on the API for
   * one thing the admin asked for once.
   *
   * THE WINDOW IS THIS PICKER'S OWN, AND LONGER THAN THE PANEL'S USUAL 250ms. A trailing debounce
   * only collapses keystrokes closer together than its delay, so the natural 300–600ms rest at a
   * space sailed straight through it and "Ramesh Kumar" was still two searches. See
   * `DRIVER_PICKER_DEBOUNCE_MS` for why this one is allowed to lag where a list filter is not.
   */
  const [typed, setTyped] = useState('');
  const search = useDebouncedValue(typed, DRIVER_PICKER_DEBOUNCE_MS);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const drivers = useAssignableDrivers(search, booking.id);
  const assign = useAssignDriver();

  const close = () => {
    onOpenChange(false);
    setTyped('');
    setSelected(null);
    setReason('');
  };

  const submit = () => {
    if (selected === null) return;
    assign.mutate(buildAssignPayload({ bookingId: booking.id, driverId: selected, reason }), {
      onSuccess: close,
    });
  };

  const copy = transferDialogCopy(booking.driver, booking.status);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={copy.title}
      description={copy.description}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={close}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={submit}
            disabled={isTransferSubmitDisabled({ selected, isPending: assign.isPending })}
          >
            {booking.driver === null
              ? assign.isPending
                ? 'Assigning…'
                : 'Assign driver'
              : assign.isPending
                ? 'Transferring…'
                : 'Transfer trip'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-text-muted" htmlFor="driver-search">
            Search drivers by name or number
          </label>
          <Input
            id="driver-search"
            value={typed}
            placeholder="Ramesh, or 9800000000"
            onChange={(event) => {
              setTyped(event.target.value);
              // The selection belongs to the list that produced it. Keeping it across a new
              // search means the admin transfers to somebody no longer on screen.
              setSelected(null);
            }}
          />
        </div>

        <div className="max-h-56 overflow-y-auto border border-border rounded-md divide-y divide-border">
          {/*
            THE HINT READS `typed`, THE RESULTS READ `search`, and the gap between them is a state
            of its own. While the debounce is still settling, the list below is the answer to an
            OLDER search term — so "No verified driver matches that" under a half-typed name would
            be a confident no about a question nobody has asked yet. `typed !== search` is exactly
            that window, and it says "Searching…" for the same reason a pending request does.
          */}
          {typed.trim().length === 0 ? (
            <p className="px-3 py-4 text-xs text-text-muted">Type a name or number to search.</p>
          ) : typed.trim().length < DRIVER_SEARCH_MIN_CHARS ? (
            /*
              BELOW THE MINIMUM NOTHING IS EVER SENT, so this must not say "Searching…" — that
              would promise a request that is not coming and leave the panel apparently hung on
              one letter. It reads `typed` rather than `search` so it appears on the keystroke
              rather than after the debounce, which is the whole point of telling somebody their
              query is too short.
            */
            <p className="px-3 py-4 text-xs text-text-muted">
              Keep typing — at least {DRIVER_SEARCH_MIN_CHARS} characters.
            </p>
          ) : drivers.isLoading || typed !== search ? (
            <p className="px-3 py-4 text-xs text-text-muted">Searching…</p>
          ) : (drivers.data?.length ?? 0) === 0 ? (
            <p className="px-3 py-4 text-xs text-text-muted">
              No verified driver matches that.
            </p>
          ) : (
            drivers.data?.map((driver) => (
              <button
                key={driver.id}
                type="button"
                onClick={() => setSelected(driver.id)}
                aria-pressed={selected === driver.id}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs ${
                  selected === driver.id ? 'bg-surface-sunken' : ''
                }`}
              >
                <span className="flex flex-col">
                  <span className="font-medium text-text">{driver.name ?? 'Unnamed driver'}</span>
                  <span className="text-text-muted">{driver.phone}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  {/*
                    A WARNING, NOT A GATE. An admin assigning an off-duty driver has almost always
                    just phoned them, which is the case manual assignment exists for — the LLD is
                    explicit that duty status may be overridden here.
                  */}
                  {driver.is_on_duty ? (
                    <Badge tone="success">On duty</Badge>
                  ) : (
                    <Badge tone="warning">Off duty — call first</Badge>
                  )}
                  {/*
                    ALSO A WARNING. The server refuses the transfer outright on a real mismatch —
                    this only lets the admin see it coming instead of finding out after a round
                    trip. `null` means no booking to compare against and shows nothing.
                  */}
                  {driver.vehicle_compatible === false && (
                    <Badge tone="warning">Vehicle mismatch</Badge>
                  )}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-text-muted" htmlFor="transfer-reason">
            Reason (optional){booking.driver === null ? '' : ' — the outgoing driver sees this'}
          </label>
          <Input
            id="transfer-reason"
            value={reason}
            maxLength={500}
            placeholder="Vehicle broke down"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}
