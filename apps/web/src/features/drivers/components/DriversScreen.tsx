'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  UserCheck,
  Clock,
  Phone,
  MapPin,
  Star,
  Eye,
  Pencil,
  MoreHorizontal,
  ArrowDown,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import { type AdminDriverListItemDto, type OnboardingStatus } from '@driverzone/contracts';
import {
  Badge,
  Button,
  Dialog,
  DataState,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FilterBar,
  FilterField,
  FormField,
  Input,
  PageHeader,
  Pagination,
  SearchInput,
  SkeletonTable,
  TopProgressBar,
  Tooltip,
  toast,
  type Column,
  cn,
} from '@driverzone/design-system';
import { toErrorState } from '@/lib/api/toErrorState';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useFilterParams } from '@/lib/hooks/useFilterParams';
import { SEARCH_DEBOUNCE_MS } from '@/lib/hooks/timing';
import { formatDate, formatTime, formatMobile } from '@/lib/format';
import { useDrivers } from '../hooks/useDrivers';
import { useToggleSuspendDriver } from '../hooks/useDriverDetails';
import { DriverEditDialog } from './DriverEditDialog';

const PAGE_SIZE = 15;

const COLUMN_WIDTHS = [
  'w-12',  // SL
  'w-56',  // Driver
  'w-36',  // Mobile
  'w-32',  // Joined Date
  'w-44',  // Address
  'w-36',  // License Expiry
  'w-32',  // Last Ride
  'w-28',  // Rating
  'w-24',  // Status
  'w-36',  // Actions
] as const;

type FilterKey = 'q' | 'status' | 'tab' | 'page';

type RowWithSL = AdminDriverListItemDto & { sl: number };

function getInitials(name: string | null | undefined): string {
  if (!name) return 'D';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return 'D';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function getExpiryStatus(expiryStr: string | null): { text: string; className: string } | null {
  if (!expiryStr) return null;
  const expiryDate = new Date(expiryStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiryDate.setHours(0, 0, 0, 0);
  const diffTime = expiryDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { text: '(Expired)', className: 'text-danger font-medium' };
  }
  if (diffDays === 0) {
    return { text: '(Expires today)', className: 'text-danger font-medium' };
  }
  if (diffDays <= 30) {
    return { text: `(${diffDays} days left)`, className: 'text-amber-500 dark:text-amber-400 font-medium' };
  }
  return { text: `(${diffDays} days left)`, className: 'text-emerald-600 dark:text-emerald-400 font-medium' };
}

export function DriversScreen() {
  const params = useFilterParams<FilterKey>();
  const router = useRouter();

  const [typed, setTyped] = useState(() => params.get('q'));
  const search = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);

  const [editingDriverId, setEditingDriverId] = useState<string | undefined>(undefined);
  const [suspendingDriver, setSuspendingDriver] = useState<{ id: string; name: string; is_suspended: boolean } | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  const toggleSuspend = useToggleSuspendDriver();

  useEffect(() => {
    if (search !== params.get('q')) params.set({ q: search, page: undefined });
  }, [search, params]);

  const status = (params.get('status') || 'ALL') as OnboardingStatus | 'ALL';
  const tab = (params.get('tab') || 'verified') as 'verified' | 'requests';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const query = useDrivers({
    page,
    limit: PAGE_SIZE,
    search: search.trim(),
    onboarding_status: tab === 'verified' ? 'ALL' : status,
    is_verified: tab === 'verified' ? 'true' : 'false',
  });

  const columns: Column<RowWithSL>[] = [
    {
      key: 'sl',
      header: 'SL',
      width: COLUMN_WIDTHS[0],
      render: (driver) => <span className="text-text-subtle font-medium text-xs">{driver.sl}</span>,
    },
    {
      key: 'driver',
      header: 'Driver',
      width: COLUMN_WIDTHS[1],
      render: (driver) => (
        <div className="flex items-center gap-3">
          {driver.profile_picture_url ? (
            <img
              src={driver.profile_picture_url}
              alt={driver.full_name || 'Driver'}
              className="size-9 rounded-full object-cover border border-border shrink-0"
            />
          ) : (
            <div className="size-9 rounded-full bg-surface-muted border border-border flex items-center justify-center font-medium text-xs text-text shrink-0">
              {getInitials(driver.full_name)}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-text truncate">
              {driver.full_name || 'Unnamed Driver'}
            </p>
            <p className="text-xs text-text-subtle truncate">
              {driver.dl_number ? driver.dl_number : 'No DL Number'}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'mobile',
      header: 'Mobile',
      width: COLUMN_WIDTHS[2],
      render: (driver) => (
        <div className="flex items-center gap-1.5 text-text">
          <Phone className="size-3.5 text-text-subtle shrink-0" />
          <span className="whitespace-nowrap text-xs font-medium">{formatMobile(driver.mobile_number)}</span>
        </div>
      ),
    },
    {
      key: 'joined_at',
      header: (
        <span className="inline-flex items-center gap-1">
          Joined Date
          <ArrowDown className="size-3 text-text-subtle" />
        </span>
      ),
      width: COLUMN_WIDTHS[3],
      render: (driver) => (
        <span className="text-text-subtle whitespace-nowrap text-xs">
          {formatDate(driver.joined_at)}
        </span>
      ),
    },
    {
      key: 'address',
      header: 'Address',
      width: COLUMN_WIDTHS[4],
      render: (driver) => (
        <div className="flex items-start gap-1.5 max-w-[180px]">
          <MapPin className="size-3.5 text-text-subtle shrink-0 mt-0.5" />
          <span className="text-xs text-text line-clamp-2" title={driver.address ?? undefined}>
            {driver.address || <span className="text-text-subtle">Not provided</span>}
          </span>
        </div>
      ),
    },
    {
      key: 'dl_expiry',
      header: 'License Expiry',
      width: COLUMN_WIDTHS[5],
      render: (driver) => {
        if (!driver.dl_expiry) {
          return <span className="text-xs text-text-subtle">Not available</span>;
        }
        const statusInfo = getExpiryStatus(driver.dl_expiry);
        return (
          <div className="leading-tight">
            <p className="text-xs text-text font-medium">{formatDate(driver.dl_expiry)}</p>
            {statusInfo && (
              <p className={cn('text-[11px]', statusInfo.className)}>{statusInfo.text}</p>
            )}
          </div>
        );
      },
    },
    {
      key: 'last_ride',
      header: 'Last Ride',
      width: COLUMN_WIDTHS[6],
      render: (driver) => {
        if (!driver.last_ride_at) {
          return <span className="text-xs text-text-subtle">Never</span>;
        }
        return (
          <div className="leading-tight">
            <p className="text-xs text-text font-medium">{formatDate(driver.last_ride_at)}</p>
            <p className="text-[11px] text-text-subtle">{formatTime(driver.last_ride_at)}</p>
          </div>
        );
      },
    },
    {
      key: 'rating',
      header: 'Rating',
      width: COLUMN_WIDTHS[7],
      render: (driver) => (
        <div className="leading-tight">
          <div className="flex items-center gap-1">
            <Star className="size-3.5 fill-amber-400 text-amber-400" />
            <span className="text-xs font-semibold text-text">
              {driver.rating !== null && driver.rating !== undefined ? Number(driver.rating).toFixed(1) : '5.0'}
            </span>
          </div>
          <p className="text-[11px] text-text-subtle">
            ({driver.total_trips ?? 0} trips)
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: COLUMN_WIDTHS[8],
      render: (driver) => {
        if (driver.is_suspended) {
          return driver.suspension_reason ? (
            <Tooltip content={`Reason: ${driver.suspension_reason}`}>
              <span className="inline-block cursor-help">
                <Badge tone="danger">Suspended</Badge>
              </span>
            </Tooltip>
          ) : (
            <Badge tone="danger">Suspended</Badge>
          );
        }
        if (driver.is_verified) {
          return driver.is_on_duty ? (
            <Badge tone="success">Active</Badge>
          ) : (
            <Badge tone="success">Active</Badge>
          );
        }
        if (driver.onboarding_status === 'REJECTED') {
          return <Badge tone="danger">Rejected</Badge>;
        }
        return <Badge tone="warning">Pending</Badge>;
      },
    },
    {
      key: 'actions',
      header: 'Action',
      width: COLUMN_WIDTHS[9],
      align: 'right',
      render: (driver) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/drivers/${driver.id}`);
            }}
          >
            View
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setEditingDriverId(driver.id);
            }}
          >
            Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-md hover:bg-surface-muted text-text-subtle hover:text-text transition-colors"
                title="More options"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => router.push(`/drivers/${driver.id}`)}
                icon={<Eye className="size-4" />}
              >
                View Full Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setEditingDriverId(driver.id)}
                icon={<Pencil className="size-4" />}
              >
                Edit Information
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive={!driver.is_suspended}
                onSelect={() =>
                  setSuspendingDriver({
                    id: driver.id,
                    name: driver.full_name || 'Driver',
                    is_suspended: driver.is_suspended,
                  })
                }
                icon={driver.is_suspended ? <CheckCircle2 className="size-4 text-success" /> : <ShieldAlert className="size-4 text-danger" />}
              >
                {driver.is_suspended ? 'Reinstate Driver' : 'Suspend Driver'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const totalItems = query.data?.pagination.total_items ?? 0;
  const pageCount = query.data?.pagination.total_pages ?? 1;
  const rows: RowWithSL[] = (query.data?.drivers ?? []).map((driver, index) => ({
    ...driver,
    sl: (page - 1) * PAGE_SIZE + index + 1,
  }));

  return (
    <>
      <PageHeader
        title="Drivers"
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Drivers' }]}
        actions={
          <div className="flex bg-surface-sunken p-1 rounded-md border border-border">
            <button
              type="button"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded transition-colors',
                tab === 'verified'
                  ? 'bg-surface shadow-sm text-text'
                  : 'text-text-subtle hover:text-text'
              )}
              onClick={() => params.set({ tab: 'verified', page: undefined, status: undefined })}
            >
              <UserCheck className="size-4" />
              Verified Drivers
            </button>
            <button
              type="button"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded transition-colors',
                tab === 'requests'
                  ? 'bg-surface shadow-sm text-text'
                  : 'text-text-subtle hover:text-text'
              )}
              onClick={() => params.set({ tab: 'requests', page: undefined, status: undefined })}
            >
              <Clock className="size-4" />
              Requests / Pending
            </button>
          </div>
        }
      />

      <FilterBar>
        <FilterField label="Search" className="flex-1 min-w-64">
          <SearchInput value={typed} onChange={setTyped} placeholder="Search by name or phone" />
        </FilterField>
      </FilterBar>

      <section className="bg-surface border border-border rounded-md overflow-hidden">
        <TopProgressBar active={query.isFetching && !query.isLoading} />

        <DataState
          loading={query.isLoading}
          error={query.isError ? toErrorState(query.error, () => void query.refetch()) : undefined}
          empty={rows.length === 0}
          emptyState={{
            icon: <Users aria-hidden className="size-6" />,
            title: 'No drivers found',
            description: 'Try adjusting your search or filters.',
          }}
          skeleton={<SkeletonTable rows={10} columns={[...COLUMN_WIDTHS]} />}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(driver) => driver.id}
            onRowClick={(driver) => router.push(`/drivers/${driver.id}`)}
            refetching={query.isFetching && !query.isLoading}
          />
          <Pagination
            page={page}
            pageCount={pageCount}
            total={totalItems}
            pageSize={PAGE_SIZE}
            onPageChange={(next) => params.set({ page: next === 1 ? undefined : String(next) })}
          />
        </DataState>
      </section>

      {/* Driver Edit Modal */}
      <DriverEditDialog
        driverId={editingDriverId}
        onClose={() => setEditingDriverId(undefined)}
      />

      {/* Driver Suspend / Reinstate Confirmation Dialog */}
      <Dialog
        open={suspendingDriver !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSuspendingDriver(null);
            setSuspendReason('');
          }
        }}
        title={suspendingDriver?.is_suspended ? 'Reinstate Driver' : 'Suspend Driver'}
        description={
          suspendingDriver?.is_suspended
            ? `Are you sure you want to reinstate ${suspendingDriver.name}? They will be able to receive ride requests.`
            : `Are you sure you want to suspend ${suspendingDriver?.name}? They will not be able to go on duty or accept rides.`
        }
      >
        {!suspendingDriver?.is_suspended && (
          <FormField label="Reason for suspension" required>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="e.g. Policy violation, incomplete document update"
              />
            )}
          </FormField>
        )}
        <div className="flex justify-end gap-2 pt-3 border-t border-border mt-4">
          <Button variant="secondary" onClick={() => setSuspendingDriver(null)}>
            Cancel
          </Button>
          <Button
            variant={suspendingDriver?.is_suspended ? 'primary' : 'danger'}
            loading={toggleSuspend.isPending}
            disabled={!suspendingDriver?.is_suspended && !suspendReason.trim()}
            onClick={async () => {
              if (!suspendingDriver) return;
              try {
                await toggleSuspend.mutateAsync({
                  id: suspendingDriver.id,
                  is_suspended: !suspendingDriver.is_suspended,
                  reason:
                    suspendReason.trim() ||
                    (suspendingDriver.is_suspended ? 'Reinstated by admin' : 'Suspended by admin'),
                });
                toast.success(
                  suspendingDriver.is_suspended
                    ? `${suspendingDriver.name} reinstated successfully`
                    : `${suspendingDriver.name} suspended successfully`
                );
                setSuspendingDriver(null);
                setSuspendReason('');
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Failed to update driver status');
              }
            }}
          >
            {suspendingDriver?.is_suspended ? 'Reinstate' : 'Suspend Driver'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
