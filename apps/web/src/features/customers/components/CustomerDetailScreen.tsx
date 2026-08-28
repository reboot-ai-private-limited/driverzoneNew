'use client';

import { useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Car,
  CircleCheck,
  CircleSlash,
  Clock,
  Home,
  MapPin,
  Pencil,
  Phone,
  Star,
  TrendingUp,
  User,
} from 'lucide-react';
import type { AdminCustomerDetailsDto, SavedAddressDto } from '@driverzone/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataState,
  PageHeader,
  Panel,
  Skeleton,
  cn,
} from '@driverzone/design-system';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatDate, formatMobile, formatTime } from '@/lib/format';
import { useCustomer } from '../hooks/useCustomer';
import { useUpdateCustomer } from '../hooks/useUpdateCustomer';
import { CustomerEditDialog } from './CustomerEditDialog';

const GENDER_LABELS: Record<string, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
  PREFER_NOT_TO_SAY: 'Prefers not to say',
};

const ADDRESS_ICONS: Record<string, typeof Home> = {
  HOME: Home,
  OFFICE: Building2,
  OTHER: MapPin,
};

/**
 * The card treatment, written ONCE and shared by every surface on this screen.
 *
 * A softer 16px corner than the 8px `Panel` default, a hairline, and `--shadow-card`. Defining
 * it here rather than repeating three utilities per card is the whole point: when the elevation
 * is tuned, it is tuned in one place, and no card drifts to a different radius or a heavier
 * shade than the one beside it.
 *
 * `cn` is tailwind-merge, so `rounded-lg` here correctly overrides `Panel`'s own `rounded-md`
 * rather than both landing in the class list and the outcome depending on stylesheet order.
 */
const CARD = 'rounded-lg border-border shadow-card h-full';

/**
 * The customer detail SCREEN — a route, not a dialog.
 *
 * It replaced a dialog because the content outgrew one: an identity header, six field groups and
 * a status footer is a screen, and putting that behind a modal costs the admin the ability to
 * link to it, open two in tabs, or press back. `/drivers/[id]` made the same call.
 *
 * HOW THIS IS STYLED. Three levels, and only three: the identity header on `--shadow-raised`,
 * the six panels on `--shadow-card`, the footer flat on the sunken ground. Elevation carries
 * hierarchy here, so it has to stay ordered — lifting every surface equally would flatten the
 * distinction it exists to make.
 *
 * The elevation itself is a deliberate exception to §Principles in
 * docs/engineering/design-language.md, which says no shadows anywhere; see the note on the
 * tokens in `theme.css`. What is NOT relaxed is the other half of that rule: a bordered card
 * inside a bordered card. So the saved addresses are hairline-divided ROWS inside their panel
 * rather than little cards within it, and the preferred pickup is a change of surface rather
 * than a nested outline.
 *
 * WHAT IS ABSENT IS DELIBERATE. The design this is built from shows a profile photo, an email
 * address, a WhatsApp number, profession, KYC status, and car model/colour/year. A customer
 * record holds none of those (`customer.model.ts`). Where a real equivalent exists it is used —
 * emergency contact in place of the email row, vehicle category in place of model — and where
 * nothing exists the row is absent rather than permanently blank. The ride figures are the one
 * exception: those fields are already on the wire and will carry values when bookings ship, so
 * they are rendered and labelled honestly until then.
 */
export function CustomerDetailScreen() {
  const { id } = useParams() as { id: string };
  const router = useRouter();

  const query = useCustomer(id);
  const update = useUpdateCustomer();

  const [editing, setEditing] = useState(false);
  const [confirmingSuspend, setConfirmingSuspend] = useState(false);

  const customer = query.data;

  return (
    <>
      <PageHeader
        title="Customer details"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Customers', href: '/customers' },
          { label: customer?.full_name ?? 'Customer details' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              icon={<ArrowLeft aria-hidden className="size-3.5" />}
              onClick={() => router.push('/customers')}
            >
              Back
            </Button>
            <Button
              size="sm"
              icon={<Pencil aria-hidden className="size-3.5" />}
              disabled={customer === undefined}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            {customer?.is_blocked === true ? (
              <Button
                size="sm"
                variant="primary"
                icon={<CircleCheck aria-hidden className="size-3.5" />}
                loading={update.isPending}
                onClick={() => update.mutate({ id, patch: { is_blocked: false } })}
              >
                Reinstate
              </Button>
            ) : (
              <Button
                size="sm"
                variant="danger"
                icon={<CircleSlash aria-hidden className="size-3.5" />}
                disabled={customer === undefined}
                onClick={() => setConfirmingSuspend(true)}
              >
                Suspend
              </Button>
            )}
          </div>
        }
      />

      <DataState
        loading={query.isLoading}
        error={query.isError ? toErrorState(query.error, () => void query.refetch()) : undefined}
        skeleton={<DetailSkeleton />}
      >
        {customer !== undefined && <CustomerBody customer={customer} />}
      </DataState>

      <CustomerEditDialog customerId={editing ? id : undefined} onClose={() => setEditing(false)} />

      {/*
        Suspending is shown with its blast radius, like zone deactivation — it is what stops
        somebody booking, and an admin should read the consequence before the click rather than
        learn it from a support ticket. Reinstating needs no confirmation: it restores the state
        everything already assumes.
      */}
      <ConfirmDialog
        open={confirmingSuspend}
        onOpenChange={setConfirmingSuspend}
        title={`Suspend ${customer?.full_name ?? 'this customer'}?`}
        consequences={[
          'They can no longer place bookings.',
          'Their record, saved addresses and vehicles are kept.',
          'You can reinstate them at any time from this screen.',
        ]}
        confirmLabel="Suspend"
        loading={update.isPending}
        onConfirm={() =>
          update.mutate(
            { id, patch: { is_blocked: true } },
            { onSuccess: () => setConfirmingSuspend(false) },
          )
        }
      />
    </>
  );
}

function CustomerBody({ customer }: { customer: AdminCustomerDetailsDto }) {
  const preferredPickup =
    customer.saved_addresses.find((a) => a.is_preferred_pickup) ??
    customer.saved_addresses.find((a) => a.is_default);

  const primaryVehicle = customer.vehicles.find((v) => v.is_default) ?? customer.vehicles[0];

  return (
    <div className="flex flex-col gap-4">
      <IdentityHeader customer={customer} />

      {/*
        `auto-rows-fr` plus the `h-full` in CARD is what makes all six panels ONE size.

        Without the first, each row is only as tall as its own tallest card, so the two rows end
        up different heights; without the second, a card sits at its content height inside a row
        that is taller than it. Both are needed, and the pair is easy to half-apply and then
        wonder why the grid is still ragged.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 auto-rows-fr">
        <Panel title="Personal information" icon={<PanelIcon icon={User} />} className={CARD}>
          <Rows>
            <Row label="Full name">{customer.full_name ?? <Unset />}</Row>
            {/* Shown as stored — a date-only string through `formatDate` would acquire a
                timezone a birthday does not have. */}
            <Row label="Date of birth">{customer.dob ?? <Unset />}</Row>
            <Row label="Gender">
              {customer.gender === null ? (
                <Unset />
              ) : (
                (GENDER_LABELS[customer.gender] ?? customer.gender)
              )}
            </Row>
            <Row label="Languages known">
              {customer.languages_known.length === 0 ? (
                <Unset />
              ) : (
                <span className="flex flex-wrap justify-end gap-1">
                  {customer.languages_known.map((language) => (
                    <Badge key={language} tone="neutral">
                      {language}
                    </Badge>
                  ))}
                </span>
              )}
            </Row>
          </Rows>
        </Panel>

        <Panel title="Contact details" icon={<PanelIcon icon={Phone} />} className={CARD}>
          <Rows>
            <Row label="Mobile number">
              <span className="tnum font-medium">{formatMobile(customer.mobile_number)}</span>
            </Row>
            <Row label="Alternate mobile">
              {customer.alternate_number === null ? (
                <Unset />
              ) : (
                <span className="tnum">{formatMobile(customer.alternate_number)}</span>
              )}
            </Row>
            <Row label="Emergency contact">
              {customer.emergency_contact === null ? (
                <Unset />
              ) : (
                // The two-line cell, the strongest idea in the design language: name over
                // number, so the pair reads as one fact rather than two rows.
                <span className="flex flex-col items-end gap-0.5">
                  <span>{customer.emergency_contact.name}</span>
                  <span className="text-xs text-text-subtle tnum">
                    {formatMobile(customer.emergency_contact.number)}
                  </span>
                </span>
              )}
            </Row>
          </Rows>
        </Panel>

        <Panel
          title="Saved addresses"
          icon={<PanelIcon icon={MapPin} />}
          actions={<Count value={customer.saved_addresses.length} />}
          className={CARD}
          flush
        >
          {customer.saved_addresses.length === 0 ? (
            <EmptyNote>No addresses saved yet.</EmptyNote>
          ) : (
            /* Hairline-divided rows, NOT bordered cards — a card inside a card is the exact
               nesting §Principles forbids. */
            <ul className="divide-y divide-border">
              {customer.saved_addresses.map((address) => (
                <AddressRow key={address.id} address={address} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Preferred pickup" icon={<PanelIcon icon={Star} />} className={CARD}>
          {preferredPickup === undefined ? (
            <EmptyNote>
              None set — the booking flow will not prefill a pickup point for this customer.
            </EmptyNote>
          ) : (
            /* A change of surface, not a border: the block reads as raised without a card. */
            <div className="rounded-md bg-surface-sunken p-3 flex flex-col gap-1">
              <span className="inline-flex items-center gap-1.5 text-xs text-text-subtle">
                <Star aria-hidden className="size-3.5 text-warning" />
                {preferredPickup.is_preferred_pickup
                  ? 'Preferred pickup location'
                  : 'Default address — used as the pickup fallback'}
              </span>
              <span className="text-sm text-text">{preferredPickup.address}</span>
              <span className="text-xs text-text-subtle tnum">
                {preferredPickup.lat.toFixed(4)}, {preferredPickup.lng.toFixed(4)}
              </span>
            </div>
          )}
        </Panel>

        <Panel
          title="Vehicle information"
          icon={<PanelIcon icon={Car} />}
          actions={<Count value={customer.vehicles.length} />}
          className={CARD}
        >
          {primaryVehicle === undefined ? (
            <EmptyNote>No vehicle saved. The customer supplies the car, not the driver.</EmptyNote>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-lg font-semibold text-text tnum tracking-wide">
                  {primaryVehicle.plate_number}
                </span>
                {primaryVehicle.is_default && <Badge tone="accent">Default</Badge>}
              </div>
              <Rows>
                <Row label="Category">{primaryVehicle.category}</Row>
                <Row label="Fuel type">{primaryVehicle.fuel_type ?? <Unset />}</Row>
                {customer.vehicles.length > 1 && (
                  <Row label="Other vehicles">
                    <span className="tnum">{customer.vehicles.length - 1}</span>
                  </Row>
                )}
              </Rows>
            </div>
          )}
        </Panel>

        <Panel title="Ride summary" icon={<PanelIcon icon={TrendingUp} />} className={CARD}>
          <Rows>
            <Row label="Joined">{formatDate(customer.joined_at)}</Row>
            <Row label="Last ride">
              {customer.last_ride_at === null ? (
                <NotTracked />
              ) : (
                <span className="flex flex-col items-end gap-0.5">
                  <span>{formatDate(customer.last_ride_at)}</span>
                  <span className="text-xs text-text-subtle tnum">
                    {formatTime(customer.last_ride_at)}
                  </span>
                </span>
              )}
            </Row>
            {/*
              Total trips has no field on the wire at all, unlike the two beside it — there is no
              `total_trips` waiting to be filled. It is listed so the panel has the shape it will
              keep, and labelled the same way so nobody reads a zero into it.
            */}
            <Row label="Total trips">
              <NotTracked />
            </Row>
            <Row label="Overall rating">
              {customer.rating === null ? <NotTracked /> : `${customer.rating.toFixed(1)} / 5`}
            </Row>
          </Rows>
        </Panel>
      </div>

      <StatusFooter customer={customer} />
    </div>
  );
}

/**
 * The identity band: who this is, on the left; the four figures worth knowing, on the right.
 *
 * `rounded-lg` where the panels below are `rounded-md` — the one deliberate difference in the
 * page, so the header reads as the subject and everything under it as detail about the subject.
 */
function IdentityHeader({ customer }: { customer: AdminCustomerDetailsDto }) {
  return (
    // `shadow-raised`, one step above the panels: the subject of the page should sit slightly
    // proud of the detail about it, which is the job elevation is actually good at.
    <section className="bg-surface border border-border rounded-lg shadow-raised p-5 flex flex-wrap items-center justify-between gap-x-10 gap-y-5">
      <div className="flex items-center gap-4 min-w-0">
        <Avatar name={customer.full_name} />
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-text truncate">
              {customer.full_name ?? <span className="text-text-subtle">Unnamed customer</span>}
            </h2>
            <Badge tone={customer.is_blocked ? 'danger' : 'success'}>
              {customer.is_blocked ? 'Suspended' : 'Active'}
            </Badge>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm text-text-subtle tnum">
            <Phone aria-hidden className="size-3.5" />
            {formatMobile(customer.mobile_number)}
          </span>
        </div>
      </div>

      <dl className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <Stat
          icon={CalendarDays}
          label="Joined"
          value={formatDate(customer.joined_at)}
        />
        <Stat icon={MapPin} label="Addresses" value={customer.saved_addresses.length} numeric />
        <Stat icon={Car} label="Vehicles" value={customer.vehicles.length} numeric />
        <Stat
          icon={Star}
          label="Rating"
          value={customer.rating === null ? <NotTracked /> : `${customer.rating.toFixed(1)} / 5`}
        />
      </dl>
    </section>
  );
}

/**
 * Initials on the ACCENT fill — the brand's one legitimate use for it. `accent` is a surface and
 * never an ink (§Color), so it can back a tile like this but could not colour the name beside it.
 *
 * Initials rather than a photograph: a customer record has no avatar field, and a stock
 * silhouette standing in for one reads as a picture that failed to load rather than as absence.
 */
function Avatar({ name }: { name: string | null }) {
  const initials =
    name === null
      ? ''
      : name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? '')
          .join('');

  return (
    <div
      className={cn(
        'size-14 shrink-0 rounded-full flex items-center justify-center',
        initials === '' ? 'bg-surface-muted' : 'bg-accent',
      )}
    >
      {initials === '' ? (
        <User aria-hidden className="size-6 text-text-subtle" />
      ) : (
        <span className="text-md font-semibold text-accent-ink">{initials}</span>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  numeric,
}: {
  icon: typeof Star;
  label: string;
  value: ReactNode;
  numeric?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="size-8 shrink-0 rounded-md bg-surface-muted flex items-center justify-center">
        <Icon aria-hidden className="size-4 text-text-subtle" />
      </span>
      <div className="flex flex-col">
        <dt className="text-xs text-text-subtle">{label}</dt>
        <dd className={cn('text-sm font-medium text-text', numeric === true && 'tnum')}>{value}</dd>
      </div>
    </div>
  );
}

/** The muted tile behind a panel's icon — a change of surface, which is the sanctioned way to
 * lift something off the page without a shadow. */
function PanelIcon({ icon: Icon }: { icon: typeof Star }) {
  return (
    <span className="size-7 rounded-md bg-surface-muted flex items-center justify-center">
      <Icon aria-hidden className="size-4 text-text-subtle" />
    </span>
  );
}

function AddressRow({ address }: { address: SavedAddressDto }) {
  const Icon = ADDRESS_ICONS[address.label] ?? MapPin;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="size-8 shrink-0 rounded-md bg-surface-muted flex items-center justify-center">
        <Icon aria-hidden className="size-4 text-text-subtle" />
      </span>
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-text capitalize">
            {address.label.toLowerCase()}
          </span>
          {address.is_default && <Badge tone="accent">Default</Badge>}
          {address.is_preferred_pickup && <Badge tone="info">Pickup</Badge>}
        </div>
        <span className="text-xs text-text-subtle">{address.address}</span>
      </div>
    </li>
  );
}

function StatusFooter({ customer }: { customer: AdminCustomerDetailsDto }) {
  return (
    // No shadow on the footer: it is a summary strip on the sunken ground, not an object
    // resting on it. Lifting everything equally would flatten the hierarchy the other two
    // levels create.
    <section className="bg-surface-sunken border border-border rounded-lg px-4 py-3 flex flex-wrap items-center gap-x-8 gap-y-2">
      <span className="inline-flex items-center gap-2 text-sm">
        {customer.is_blocked ? (
          <CircleSlash aria-hidden className="size-4 text-danger" />
        ) : (
          <CircleCheck aria-hidden className="size-4 text-success" />
        )}
        <span className="text-text-subtle">Account status</span>
        <span className={cn('font-medium', customer.is_blocked ? 'text-danger' : 'text-success')}>
          {customer.is_blocked ? 'Suspended' : 'Active'}
        </span>
      </span>

      <span className="inline-flex items-center gap-2 text-sm">
        <Clock aria-hidden className="size-4 text-text-subtle" />
        <span className="text-text-subtle">Last updated</span>
        <span className="text-text">
          {formatDate(customer.updated_at)}, {formatTime(customer.updated_at)}
        </span>
      </span>

      <span className="ml-auto text-xs text-text-subtle tnum">Account ID {customer.id}</span>
    </section>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-border">{children}</dl>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-xs text-text-subtle shrink-0">{label}</dt>
      <dd className="text-sm text-text text-right min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Count({ value }: { value: number }) {
  return <span className="text-xs text-text-subtle tnum">{value}</span>;
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-text-subtle px-4 py-3">{children}</p>;
}

/** A field the customer has not filled in. Profiles complete progressively; this is normal. */
function Unset() {
  return <span className="text-text-subtle">—</span>;
}

/**
 * Distinct from `Unset`. An empty ride figure means the bookings module does not exist yet
 * (tier 6, docs/LLD/roadmap.md), not that this customer has never ridden.
 */
function NotTracked() {
  return <span className="text-text-subtle italic text-xs font-normal">Not tracked yet</span>;
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-28 rounded-lg" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 auto-rows-fr">
        {Array.from({ length: 6 }, (_, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <Skeleton key={index} className="h-52 rounded-md" />
        ))}
      </div>
      <Skeleton className="h-12 rounded-md" />
    </div>
  );
}
