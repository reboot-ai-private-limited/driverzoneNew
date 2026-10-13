'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Car, IndianRupee, MapPin, Search, User, UserPlus, X } from 'lucide-react';
import {
  Button,
  DefinitionList,
  FieldRow,
  FormField,
  Input,
  PageHeader,
  Panel,
  SegmentedControl,
  Select,
} from '@driverzone/design-system';
import {
  CAR_CATEGORIES,
  CAR_CATEGORY_LABELS,
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPE_PREFERENCES,
  type AdminCustomerListItemDto,
  type AdminPaymentMode,
  type CarCategory,
  type CreateQuoteResponse,
  type Direction,
  type VehicleTypePreference,
} from '@driverzone/contracts';
import { isUnavailable } from '@/lib/api/endpoints/quotes';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { SEARCH_DEBOUNCE_MS } from '@/lib/hooks/timing';
import { useCustomers } from '@/features/customers/hooks/useCustomers';
import { useAdminQuote, useCreateBooking, useCreateCustomer } from '../hooks/useBookings';
import {
  buildCreateBookingRequest,
  buildQuoteRequest,
  quoteBlocker,
  toIndianE164,
  type TripDraft,
  type TripPoint,
} from '../lib/newBooking';
import { BookingPickerMap, type PointKind } from './BookingPickerMap';
import { PlacePicker } from './PlacePicker';

/** Who the trip is for — enough to show and to book with. */
interface ChosenCustomer {
  id: string;
  name: string | null;
  phone: string;
}

const EMPTY_TRIP: TripDraft = {
  pickup: null,
  drop: null,
  when: 'NOW',
  scheduledLocal: '',
  direction: 'ONE_WAY',
  returnLocal: '',
  insurance: true,
};

/**
 * NEW BOOKING — an admin books a trip ON A CUSTOMER'S BEHALF, the same flow as the app.
 *
 * Map on the left, form on the right. Pickup and destination are set ON THE MAP — search above
 * it, click it, or drag a pin (`BookingPickerMap`); the form shows what was set and which end the
 * map is setting. Then: customer → when → fare → car → confirm. The fare comes from the same quote
 * engine the app uses (`POST /admin/quotes`, bound to this customer), and the booking is the same
 * booking — with two differences the server applies, not this screen:
 *
 *   - NOBODY IS RUNG. It is created with manual dispatch; the admin assigns a driver from the
 *     booking's own page, where this screen sends them.
 *   - THE TRIP CODE IS SHOWN. The customer may not have the app, so the admin passes it on.
 *
 * PAYMENT IS THE ADMIN'S CALL (2026-10-13): Cash — the driver collects at the end — or Prepaid —
 * the customer already paid the company, so the driver collects nothing for the fare. Extras that
 * build up during the trip (waiting, an extra day) are still settled at the end either way.
 */
export function NewBookingScreen() {
  const router = useRouter();

  const [customer, setCustomer] = useState<ChosenCustomer | null>(null);
  const [trip, setTrip] = useState<TripDraft>(EMPTY_TRIP);
  const [quote, setQuote] = useState<CreateQuoteResponse | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [carCategory, setCarCategory] = useState<CarCategory | ''>('');
  const [vehicleType, setVehicleType] = useState<VehicleTypePreference | ''>('');
  /*
   * NO DEFAULT. "Prepaid" means the driver collects nothing, so a pre-selected answer the admin
   * never looked at would either have a driver ask for money already paid or not collect money
   * that is owed. The server requires it for the same reason.
   */
  const [paymentMode, setPaymentMode] = useState<AdminPaymentMode | ''>('');
  const [paymentReference, setPaymentReference] = useState('');

  /** Which end the map is setting. Moves to the destination once the pickup is first placed. */
  const [active, setActive] = useState<PointKind>('pickup');

  const quoteCall = useAdminQuote();
  const create = useCreateBooking();

  const setPoint = (kind: PointKind, point: TripPoint | null) => {
    if (kind === 'pickup' && point !== null && trip.pickup === null && trip.drop === null) {
      setActive('drop');
    }
    setTrip((prev) => ({ ...prev, [kind]: point }));
  };

  /*
   * A PRICE BELONGS TO THE TRIP AND THE CUSTOMER IT WAS ASKED FOR. Change either and the quote on
   * screen is for something else — the server would refuse it for another customer anyway, and a
   * moved pickup must never book at the old pickup's price.
   *
   * Keyed on what PRICES the trip — coordinates and times, not the address labels. A reverse
   * geocode relabelling a pin a moment after it was dropped must not throw away a fare.
   */
  const priceKey = JSON.stringify([
    customer?.id,
    trip.pickup?.lat,
    trip.pickup?.lng,
    trip.drop?.lat,
    trip.drop?.lng,
    trip.when,
    trip.scheduledLocal,
    trip.direction,
    trip.returnLocal,
    trip.insurance,
  ]);
  useEffect(() => {
    setQuote(null);
    setUnavailable(null);
    setOptionId(null);
  }, [priceKey]);

  const blocker = customer === null ? 'Choose the customer first.' : quoteBlocker(trip);

  const getFare = () => {
    if (customer === null || blocker !== null) return;
    quoteCall.mutate(buildQuoteRequest(customer.id, trip), {
      onSuccess: (result) => {
        if (isUnavailable(result)) {
          setUnavailable(result.message);
          return;
        }
        setQuote(result);
        // One option (outstation) is chosen for them; several (incity durations) are their call.
        setOptionId(result.options.length === 1 ? (result.options[0]?.quote_id ?? null) : null);
      },
    });
  };

  const chosen = quote?.options.find((o) => o.quote_id === optionId) ?? null;
  const canBook =
    customer !== null &&
    chosen !== null &&
    trip.pickup !== null &&
    trip.drop !== null &&
    carCategory !== '' &&
    vehicleType !== '' &&
    paymentMode !== '' &&
    !create.isPending;

  const book = () => {
    if (customer === null || chosen === null || trip.pickup === null || trip.drop === null) return;
    if (carCategory === '' || vehicleType === '' || paymentMode === '' || create.isPending) return;
    create.mutate(
      buildCreateBookingRequest({
        customerId: customer.id,
        quoteId: chosen.quote_id,
        pickup: trip.pickup,
        drop: trip.drop,
        carCategory,
        vehicleType,
        paymentMode,
        paymentReference,
      }),
      {
        onSuccess: (result) => router.push(`/bookings/${result.booking.id}`),
        onError: () => {
          // An expired price is the likely failure after a long pause on this screen. Clearing it
          // makes "Get fare" the obvious next step rather than a second doomed Confirm.
          setQuote(null);
          setOptionId(null);
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        title="New Booking"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Bookings', href: '/bookings' },
          { label: 'New Booking' },
        ]}
        actions={
          <Button
            size="sm"
            icon={<ArrowLeft aria-hidden className="size-3.5" />}
            onClick={() => router.push('/bookings')}
          >
            Back to Bookings
          </Button>
        }
      />

      {/*
        MAP LEFT, FORM RIGHT. The map is sticky on a wide screen so it stays beside whichever panel
        the admin has scrolled to; on a narrow one it simply comes first.
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-[60vh] min-h-96 lg:sticky lg:top-4 lg:col-span-3 lg:h-[calc(100vh-8rem)]">
          <BookingPickerMap
            pickup={trip.pickup}
            drop={trip.drop}
            active={active}
            onChange={setPoint}
          />
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <CustomerPanel customer={customer} onChange={setCustomer} />

          <Panel title="Trip" icon={<MapPin aria-hidden className="size-4" />}>
            <TripForm
              trip={trip}
              onChange={setTrip}
              active={active}
              onActivate={setActive}
              onPoint={setPoint}
            />
          </Panel>

          <Panel title="Fare" icon={<IndianRupee aria-hidden className="size-4" />}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={getFare}
                  disabled={blocker !== null || quoteCall.isPending}
                  loading={quoteCall.isPending}
                >
                  {quote === null ? 'Get fare' : 'Refresh fare'}
                </Button>
                {blocker !== null && <span className="text-xs text-text-subtle">{blocker}</span>}
              </div>

              {unavailable !== null && (
                <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                  {unavailable}
                </div>
              )}

              {quote !== null && (
                <FareOptions quote={quote} selected={optionId} onSelect={setOptionId} />
              )}
            </div>
          </Panel>

          <Panel title="Car" icon={<Car aria-hidden className="size-4" />}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Car category" required>
                {({ id }) => (
                  <Select
                    id={id}
                    value={carCategory}
                    onValueChange={(v) => setCarCategory(v as CarCategory)}
                    placeholder="Choose the customer's car"
                    options={CAR_CATEGORIES.map((c) => ({ value: c, label: CAR_CATEGORY_LABELS[c] }))}
                  />
                )}
              </FormField>
              <FormField label="Gearbox" required hint="Decides which drivers can take it.">
                {({ id }) => (
                  <Select
                    id={id}
                    value={vehicleType}
                    onValueChange={(v) => setVehicleType(v as VehicleTypePreference)}
                    placeholder="Choose"
                    options={VEHICLE_TYPE_PREFERENCES.map((t) => ({
                      value: t,
                      label: VEHICLE_TYPE_LABELS[t],
                    }))}
                  />
                )}
              </FormField>
            </div>
          </Panel>

          <Panel title="Payment" icon={<IndianRupee aria-hidden className="size-4" />}>
            <div className="flex flex-col gap-3">
              {/*
                TWO BOXES, side by side — each says what it means, so the admin reads the
                consequence before choosing. "Postpaid" is the `CASH` mode on the wire: the fare
                is collected at the end, in cash (or online, if the customer pays in the app).
              */}
              <div role="radiogroup" aria-label="How is the fare paid" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <PaymentOption
                  selected={paymentMode === 'PREPAID'}
                  onSelect={() => setPaymentMode('PREPAID')}
                  title="Prepaid"
                  description="The customer has already paid the company. The driver collects nothing for the fare."
                />
                <PaymentOption
                  selected={paymentMode === 'CASH'}
                  onSelect={() => setPaymentMode('CASH')}
                  title="Postpaid"
                  description="The customer pays at the end of the trip — cash to the driver, or online in the app."
                />
              </div>
              {paymentMode === '' && (
                <p className="text-xs text-text-subtle">Choose how the fare is paid.</p>
              )}
              {paymentMode === 'PREPAID' && (
                <p className="text-xs text-text-subtle">
                  Waiting time or an extra day, if any, is still collected at the end.
                </p>
              )}
              {paymentMode === 'PREPAID' && (
                <FormField label="Payment reference" hint="UTR or transfer reference, for the record.">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={paymentReference}
                      maxLength={200}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      placeholder="e.g. UTR 412345678901"
                    />
                  )}
                </FormField>
              )}
            </div>
          </Panel>

          <Panel title="Summary">
            <div className="flex flex-col gap-3">
              <DefinitionList>
                <FieldRow label="Customer">
                  {customer === null ? '—' : (customer.name ?? customer.phone)}
                </FieldRow>
                <FieldRow label="Pickup">{trip.pickup?.address ?? '—'}</FieldRow>
                <FieldRow label="Drop">{trip.drop?.address ?? '—'}</FieldRow>
                <FieldRow label="Fare">{chosen?.fare.total.amount_display ?? '—'}</FieldRow>
                <FieldRow label="Payment">
                  {paymentMode === 'PREPAID'
                    ? 'Prepaid — nothing to collect for the fare'
                    : paymentMode === 'CASH'
                      ? 'Postpaid — paid at the end of the trip'
                      : '—'}
                </FieldRow>
                <FieldRow label="Driver">Assigned by you, after booking</FieldRow>
              </DefinitionList>

              <Button variant="primary" onClick={book} disabled={!canBook} loading={create.isPending}>
                Confirm booking
              </Button>
              <p className="text-xs text-text-subtle">
                No driver is rung automatically. You will assign one on the next screen, where the
                customer&apos;s trip code (OTP) is also shown.{' '}
                {paymentMode === 'PREPAID'
                  ? 'Wallet credit and dues are not applied to a prepaid trip — they stay on the customer’s account.'
                  : 'Any wallet credit or dues on the customer’s account are applied to the total.'}
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

// ─── Payment ────────────────────────────────────────────────────────────────────────────────

/**
 * One of the two payment boxes. A radio in a box rather than a toggle, styled like the fare
 * options above it, so "which one is chosen" reads the same way everywhere on this screen.
 */
function PaymentOption({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left ${
        selected ? 'border-interactive bg-interactive/10' : 'border-border hover:bg-surface-muted'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        <span
          aria-hidden
          className={`flex size-4 items-center justify-center rounded-full border ${
            selected ? 'border-interactive' : 'border-border'
          }`}
        >
          {selected && <span className="size-2 rounded-full bg-interactive" />}
        </span>
        {title}
      </span>
      <span className="text-xs text-text-subtle">{description}</span>
    </button>
  );
}

// ─── Customer ───────────────────────────────────────────────────────────────────────────────

function CustomerPanel({
  customer,
  onChange,
}: {
  customer: ChosenCustomer | null;
  onChange: (customer: ChosenCustomer | null) => void;
}) {
  const [mode, setMode] = useState<'FIND' | 'NEW'>('FIND');

  return (
    <Panel
      title="Customer"
      icon={<User aria-hidden className="size-4" />}
      actions={
        customer === null ? (
          <SegmentedControl
            label="Find or add a customer"
            value={mode}
            onValueChange={setMode}
            segments={[
              { value: 'FIND', label: 'Find', icon: <Search aria-hidden className="size-3.5" /> },
              { value: 'NEW', label: 'New', icon: <UserPlus aria-hidden className="size-3.5" /> },
            ]}
          />
        ) : undefined
      }
    >
      {customer !== null ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-2">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{customer.name ?? 'Unnamed customer'}</span>
            <span className="text-xs tabular-nums text-text-subtle">{customer.phone}</span>
          </div>
          <button
            type="button"
            aria-label="Change customer"
            className="text-text-subtle hover:text-interactive"
            onClick={() => onChange(null)}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ) : mode === 'FIND' ? (
        <FindCustomer onPick={onChange} />
      ) : (
        <NewCustomer onCreated={onChange} />
      )}
    </Panel>
  );
}

function FindCustomer({ onPick }: { onPick: (customer: ChosenCustomer) => void }) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const enabled = debounced.length >= 2;
  const result = useCustomers({ search: enabled ? debounced : undefined, limit: 6 });
  const rows: AdminCustomerListItemDto[] = enabled ? (result.data?.customers ?? []) : [];

  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder="Search by name or mobile number"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      {!enabled ? (
        <span className="text-xs text-text-subtle">Type at least two characters.</span>
      ) : result.isLoading ? (
        <span className="text-xs text-text-subtle">Searching…</span>
      ) : rows.length === 0 ? (
        <span className="text-xs text-text-subtle">
          No customer matches. Use “New” to add them by mobile number.
        </span>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                disabled={row.is_blocked}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted disabled:opacity-50"
                onClick={() =>
                  onPick({ id: row.id, name: row.full_name, phone: row.mobile_number })
                }
              >
                <span className="text-sm">{row.full_name ?? 'Unnamed customer'}</span>
                <span className="text-xs tabular-nums text-text-subtle">
                  {row.mobile_number}
                  {row.is_blocked ? ' · blocked' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewCustomer({ onCreated }: { onCreated: (customer: ChosenCustomer) => void }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const createCustomer = useCreateCustomer();

  const e164 = toIndianE164(phone);
  const phoneError = phone.trim() !== '' && e164 === null ? 'Enter a 10-digit Indian mobile number.' : undefined;

  const submit = () => {
    if (e164 === null) return;
    createCustomer.mutate(
      { mobile_number: e164, ...(name.trim() === '' ? {} : { full_name: name.trim() }) },
      {
        onSuccess: ({ customer }) =>
          onCreated({ id: customer.id, name: customer.full_name, phone: customer.mobile_number }),
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Mobile number" required error={phoneError}>
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              invalid={invalid}
              aria-describedby={describedBy}
              placeholder="98765 43210"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          )}
        </FormField>
        <FormField label="Name" hint="Optional — they can add it in the app later.">
          {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </FormField>
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          disabled={e164 === null || createCustomer.isPending}
          loading={createCustomer.isPending}
        >
          Use this customer
        </Button>
        <span className="text-xs text-text-subtle">
          If the number already has an account, that account is used.
        </span>
      </div>
    </div>
  );
}

// ─── Trip ───────────────────────────────────────────────────────────────────────────────────

function TripForm({
  trip,
  onChange,
  active,
  onActivate,
  onPoint,
}: {
  trip: TripDraft;
  onChange: (trip: TripDraft) => void;
  active: PointKind;
  onActivate: (kind: PointKind) => void;
  onPoint: (kind: PointKind, point: TripPoint | null) => void;
}) {
  const set = <K extends keyof TripDraft>(key: K, value: TripDraft[K]) =>
    onChange({ ...trip, [key]: value });

  return (
    <div className="flex flex-col gap-4">
      <FormField label="Pickup" required>
        {() => (
          <PlacePicker
            label="Pickup"
            color="#16a34a"
            value={trip.pickup}
            active={active === 'pickup'}
            onActivate={() => onActivate('pickup')}
            onChange={(p) => onPoint('pickup', p)}
          />
        )}
      </FormField>
      <FormField label="Destination" required>
        {() => (
          <PlacePicker
            label="Destination"
            color="#dc2626"
            value={trip.drop}
            active={active === 'drop'}
            onActivate={() => onActivate('drop')}
            onChange={(p) => onPoint('drop', p)}
          />
        )}
      </FormField>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="When">
          {() => (
            <div className="flex flex-col gap-2">
              <SegmentedControl
                label="When"
                value={trip.when}
                onValueChange={(v) => set('when', v)}
                segments={[
                  { value: 'NOW', label: 'Now' },
                  { value: 'LATER', label: 'Schedule' },
                ]}
              />
              {trip.when === 'LATER' && (
                <Input
                  type="datetime-local"
                  aria-label="Pickup date and time (IST)"
                  value={trip.scheduledLocal}
                  onChange={(e) => set('scheduledLocal', e.target.value)}
                />
              )}
            </div>
          )}
        </FormField>

        <FormField label="Outstation trip" hint="Ignored for in-city trips.">
          {() => (
            <div className="flex flex-col gap-2">
              <SegmentedControl<Direction>
                label="Direction"
                value={trip.direction}
                onValueChange={(v) => onChange({ ...trip, direction: v, returnLocal: '' })}
                segments={[
                  { value: 'ONE_WAY', label: 'One way' },
                  { value: 'ROUND_TRIP', label: 'Round trip' },
                ]}
              />
              {trip.direction === 'ROUND_TRIP' && (
                <Input
                  type="datetime-local"
                  aria-label="Return date and time (IST)"
                  value={trip.returnLocal}
                  onChange={(e) => set('returnLocal', e.target.value)}
                />
              )}
            </div>
          )}
        </FormField>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={trip.insurance}
          onChange={(e) => set('insurance', e.target.checked)}
        />
        Include trip insurance
      </label>
      <span className="-mt-3 text-xs text-text-subtle">Times are in IST.</span>
    </div>
  );
}

// ─── Fare ───────────────────────────────────────────────────────────────────────────────────

function FareOptions({
  quote,
  selected,
  onSelect,
}: {
  quote: CreateQuoteResponse;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const chosen = useMemo(
    () => quote.options.find((o) => o.quote_id === selected) ?? null,
    [quote, selected],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-text-subtle">
        {quote.service_type === 'OUTSTATION' ? 'Outstation' : 'In-city'}
        {quote.distance_km === null ? '' : ` · ${quote.distance_km.toFixed(1)} km`}
        {' · '}price held until{' '}
        {new Date(quote.expires_at).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Kolkata',
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {quote.options.map((option) => (
          <button
            key={option.quote_id}
            type="button"
            onClick={() => onSelect(option.quote_id)}
            className={`flex flex-col items-start rounded-md border px-3 py-2 text-left ${
              option.quote_id === selected
                ? 'border-interactive bg-interactive/10'
                : 'border-border hover:bg-surface-muted'
            }`}
          >
            <span className="text-sm font-medium">{option.label}</span>
            <span className="text-sm tabular-nums">{option.fare.total.amount_display}</span>
          </button>
        ))}
      </div>

      {chosen !== null && (
        <DefinitionList>
          {chosen.fare.lines.map((line) => (
            <FieldRow key={line.code} label={line.label}>
              {line.amount.amount_display}
            </FieldRow>
          ))}
          <FieldRow label="Total">
            <span className="font-semibold">{chosen.fare.total.amount_display}</span>
          </FieldRow>
        </DefinitionList>
      )}
    </div>
  );
}
