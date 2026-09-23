'use client';

import { useMemo, useState } from 'react';
import { MoreHorizontal, Pencil, ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import {
  Badge,
  Button,
  CellStack,
  ConfirmDialog,
  DataState,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  PageHeader,
  SkeletonTable,
  TopProgressBar,
  type Column,
} from '@driverzone/design-system';
import type { AdminUserDto } from '@driverzone/contracts';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatDate, formatMobile } from '@/lib/format';
import { useSession } from '@/lib/auth/SessionProvider';
import { useAdmins, useSetAdminActive } from '../hooks/useAdmins';
import { AdminFormDialog } from './AdminFormDialog';

const COLUMN_WIDTHS = ['w-56', 'w-36', 'w-28', 'w-24', 'w-28', 'w-10'];

/**
 * `/admins` — who can sign in to this panel. SUPER_ADMIN only.
 *
 * Nothing here deletes an admin. Deactivating keeps the row, so every audit entry an admin ever
 * wrote still resolves to a name, and reactivating restores the same person rather than a
 * look-alike with a new id.
 */
export function AdminsScreen() {
  const { admin: self } = useSession();
  const admins = useAdmins();
  const setActive = useSetAdminActive();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserDto | undefined>(undefined);
  const [deactivating, setDeactivating] = useState<AdminUserDto | undefined>(undefined);

  const rows = admins.data?.admins ?? [];

  const columns = useMemo<Column<AdminUserDto>[]>(
    () => [
      {
        key: 'name',
        header: 'Admin',
        render: (row) => (
          <CellStack
            primary={
              <span className="flex items-center gap-2">
                {row.full_name}
                {row.id === self?.id && <Badge tone="info">You</Badge>}
              </span>
            }
            secondary={formatMobile(row.mobile_number)}
          />
        ),
      },
      {
        key: 'role',
        header: 'Role',
        render: (row) =>
          row.admin_role === 'SUPER_ADMIN' ? (
            <Badge tone="accent" icon={<ShieldCheck aria-hidden className="size-3" />}>
              Super admin
            </Badge>
          ) : (
            <Badge>Admin</Badge>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) =>
          row.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Deactivated</Badge>,
      },
      {
        key: 'added',
        header: 'Added',
        render: (row) => formatDate(row.created_at),
      },
      {
        key: 'deactivated',
        header: 'Deactivated',
        render: (row) =>
          row.deactivated_at === null ? <span className="text-text-subtle">—</span> : formatDate(row.deactivated_at),
      },
      {
        key: 'actions',
        header: <span className="sr-only">Actions</span>,
        align: 'right',
        render: (row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" label={`Actions for ${row.full_name}`} icon={<MoreHorizontal aria-hidden className="size-4" />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                icon={<Pencil aria-hidden className="size-4" />}
                onSelect={() => {
                  setEditing(row);
                  setFormOpen(true);
                }}
              >
                Edit name or role
              </DropdownMenuItem>
              {row.is_active ? (
                <DropdownMenuItem
                  destructive
                  // Yourself: the server refuses it; disabling it says so before a round trip.
                  disabled={row.id === self?.id}
                  icon={<UserMinus aria-hidden className="size-4" />}
                  onSelect={() => setDeactivating(row)}
                >
                  Deactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  icon={<UserPlus aria-hidden className="size-4" />}
                  onSelect={() => setActive.mutate({ id: row.id, active: true })}
                >
                  Reactivate
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [self?.id, setActive],
  );

  return (
    <>
      <PageHeader
        title="Admins"
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Admins' }]}
        actions={
          <Button
            size="sm"
            variant="primary"
            icon={<UserPlus aria-hidden className="size-4" />}
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            Add admin
          </Button>
        }
      />

      <section className="bg-surface border border-border rounded-md overflow-hidden">
        <TopProgressBar active={admins.isFetching && !admins.isLoading} />
        <DataState
          loading={admins.isLoading}
          error={admins.isError ? toErrorState(admins.error, () => void admins.refetch()) : undefined}
          empty={rows.length === 0}
          emptyState={{
            icon: <ShieldCheck aria-hidden className="size-6" />,
            title: 'No admins',
            description: 'Add the first one with the button above.',
          }}
          skeleton={<SkeletonTable rows={4} columns={COLUMN_WIDTHS} />}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            refetching={admins.isFetching && !admins.isLoading}
          />
        </DataState>
      </section>

      <AdminFormDialog open={formOpen} editing={editing} selfId={self?.id} onClose={() => setFormOpen(false)} />

      <ConfirmDialog
        open={deactivating !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeactivating(undefined);
        }}
        title={`Deactivate ${deactivating?.full_name ?? ''}?`}
        consequences={[
          'They are signed out of the panel on every device.',
          'They cannot sign in again until reactivated.',
          'Their past actions stay in the audit log under their name.',
        ]}
        confirmLabel="Deactivate"
        loading={setActive.isPending}
        onConfirm={() => {
          if (deactivating === undefined) return;
          setActive.mutate(
            { id: deactivating.id, active: false },
            { onSuccess: () => setDeactivating(undefined) },
          );
        }}
      />
    </>
  );
}
