'use client';

import { useState } from 'react';
import { Wallet, IndianRupee, ArrowDownRight, ArrowUpRight, Search, X } from 'lucide-react';
import type { LedgerEntryDto, TransactionType } from '@driverzone/contracts';
import {
  Badge,
  Button,
  DataState,
  DataTable,
  Input,
  Panel,
  SkeletonTable,
  type Column,
} from '@driverzone/design-system';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatPaise, formatDate, formatTime } from '@/lib/format';
import { useDriverWallet } from '../hooks/useDriverDetails';

const COLUMN_WIDTHS = ['w-32', 'w-48', 'w-64', 'w-32', 'w-32'];

export function DriverWalletTab({ driverId }: { driverId: string }) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  const query = useDriverWallet(driverId, appliedFrom, appliedTo);

  const columns: Column<LedgerEntryDto>[] = [
    {
      key: 'date',
      header: 'Date & Time',
      width: COLUMN_WIDTHS[0] ?? '',
      render: (entry) => (
        <div className="flex flex-col">
          <span>{formatDate(entry.created_at)}</span>
          <span className="text-xs text-text-subtle mt-0.5">{formatTime(entry.created_at)}</span>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Transaction Type',
      width: COLUMN_WIDTHS[1] ?? '',
      render: (entry) => {
        /*
         * One label per value of `TRANSACTION_TYPES`. `CASH_COLLECTED` is the one an admin opens
         * this screen for: it is the money a driver is holding on the company's behalf, and it is
         * why a balance can be negative at all.
         */
        const labels: Record<TransactionType, string> = {
          TRIP_EARNING: 'Trip Earning',
          WAITING_EARNING: 'Waiting Time',
          COMMISSION_DEBIT: 'Commission',
          CASH_COLLECTED: 'Cash Collected',
          PAYOUT: 'Payout',
          ADJUSTMENT: 'Adjustment',
          PENALTY: 'Penalty',
          BONUS: 'Bonus',
        };
        return <span className="font-medium">{labels[entry.type] || entry.type}</span>;
      },
    },
    {
      key: 'description',
      header: 'Description',
      width: COLUMN_WIDTHS[2] ?? '',
      render: (entry) => (
        <div className="flex flex-col">
          <span className="text-text">{entry.description}</span>
          {entry.reference_id && (
            <span className="text-xs text-text-subtle mt-0.5 tnum">Ref: {entry.reference_id}</span>
          )}
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[3] ?? '',
      render: (entry) => {
        const isPositive = entry.amount_paise > 0;
        const isNegative = entry.amount_paise < 0;
        return (
          <div className={`flex items-center justify-end gap-1 font-medium tnum ${isPositive ? 'text-success' : isNegative ? 'text-danger' : ''}`}>
            {isPositive && <ArrowUpRight className="size-3" />}
            {isNegative && <ArrowDownRight className="size-3" />}
            {formatPaise(Math.abs(entry.amount_paise))}
          </div>
        );
      },
    },
    {
      key: 'balance',
      header: 'Balance After',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[4] ?? '',
      render: (entry) => (
        <span className="font-medium tnum">{formatPaise(entry.balance_after_paise)}</span>
      ),
    },
  ];

  if (query.isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-24 bg-surface-sunken animate-pulse rounded-md border border-border" />
          <div className="h-24 bg-surface-sunken animate-pulse rounded-md border border-border" />
        </div>
        <Panel title="Ledger History">
          <SkeletonTable rows={5} columns={COLUMN_WIDTHS} />
        </Panel>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <DataState
        loading={false}
        skeleton={<></>}
        error={query.isError ? toErrorState(query.error, () => query.refetch()) : undefined}
      >
        <div />
      </DataState>
    );
  }

  const { wallet, ledger } = query.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col p-5 rounded-md border border-border bg-surface">
          <div className="flex items-center gap-2 text-text-subtle mb-3">
            <Wallet className="size-4" />
            <span className="text-sm font-medium">Current Balance</span>
          </div>
          <div className="flex items-end gap-3">
            <span className={`text-3xl font-semibold tnum ${wallet.balance_paise < 0 ? 'text-danger' : 'text-text'}`}>
              {formatPaise(wallet.balance_paise)}
            </span>
            {wallet.is_suspended_for_balance && (
              <Badge tone="danger" className="mb-1">Suspended (Negative Balance)</Badge>
            )}
          </div>
        </div>

        <div className="flex flex-col p-5 rounded-md border border-border bg-surface">
          <div className="flex items-center gap-2 text-text-subtle mb-3">
            <IndianRupee className="size-4" />
            <span className="text-sm font-medium">Lifetime Earnings</span>
          </div>
          <span className="text-3xl font-semibold tnum text-text">
            {formatPaise(wallet.lifetime_earnings_paise)}
          </span>
        </div>
      </div>

      <Panel title="Ledger History">
        <div className="flex flex-col sm:flex-row gap-3 mb-4 items-end">
          <div className="flex-1 max-w-[200px]">
            <label htmlFor="wallet-from-date" className="block text-xs font-medium text-text-subtle mb-1">From Date</label>
            <Input
              id="wallet-from-date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="flex-1 max-w-[200px]">
            <label htmlFor="wallet-to-date" className="block text-xs font-medium text-text-subtle mb-1">To Date</label>
            <Input
              id="wallet-to-date"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            icon={<Search className="size-4" />}
            onClick={() => { setAppliedFrom(fromDate); setAppliedTo(toDate); }}
          >
            Filter
          </Button>
          {(appliedFrom || appliedTo) && (
            <Button
              variant="secondary"
              icon={<X className="size-4" />}
              onClick={() => { setFromDate(''); setToDate(''); setAppliedFrom(''); setAppliedTo(''); }}
            >
              Clear
            </Button>
          )}
        </div>
        <DataState
          loading={false}
          skeleton={<></>}
          empty={ledger.length === 0}
          emptyState={{
            icon: <Wallet aria-hidden className="size-6" />,
            title: 'No transactions yet',
            description: 'This driver has no ledger entries.',
          }}
        >
          <DataTable
            columns={columns}
            rows={ledger}
            rowKey={(entry) => entry.id}
          />
        </DataState>
      </Panel>
    </div>
  );
}
