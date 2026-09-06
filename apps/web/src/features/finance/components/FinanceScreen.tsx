'use client';

import { PageHeader, SegmentedControl } from '@driverzone/design-system';
import { useFilterParams } from '@/lib/hooks/useFilterParams';
import { DriverBalancesTab } from './DriverBalancesTab';
import { CustomerWalletsTab } from './CustomerWalletsTab';
import { TransactionsTab } from './TransactionsTab';

const TABS = [
  { value: 'balances', label: 'Driver balances' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'customers', label: 'Customer wallets' },
] as const;

type Tab = (typeof TABS)[number]['value'];

/**
 * The Finance screen.
 *
 * THE TAB LIVES IN THE URL, not in `useState`. Each tab carries its own filters, which are
 * already in the URL — so keeping the tab out of it would produce a link that restores somebody's
 * filters but not the tab those filters belong to, which is worse than restoring neither. It also
 * means "drivers owing over ₹1,000" is a link an admin can paste into a chat, which is the
 * reason `useFilterParams` exists.
 *
 * All three tabs are live, and each prefixes its own filter keys (`q`, `tq`, `cq`) so they cannot
 * collide in one URL — see the note in `TransactionsTab`.
 */
export function FinanceScreen() {
  const params = useFilterParams<'tab'>();
  const tab = (params.get('tab') || 'balances') as Tab;

  return (
    <>
      {/* Hidden on print: the exported sheet writes its own header, filters and timestamp. */}
      <div className="print:hidden">
        <PageHeader
          title="Finance"
          breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Finance' }]}
        />
      </div>

      <div className="print:hidden">
        <SegmentedControl
          label="Finance view"
          value={tab}
          onValueChange={(value) => params.set({ tab: value === 'balances' ? undefined : value })}
          segments={[...TABS]}
        />
      </div>

      {tab === 'transactions' ? (
        <TransactionsTab />
      ) : tab === 'customers' ? (
        <CustomerWalletsTab />
      ) : (
        <DriverBalancesTab />
      )}
    </>
  );
}
