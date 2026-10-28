'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Badge,
  type BadgeTone,
  Button,
  DataState,
  Dialog,
  EmptyState,
  FilterBar,
  FilterField,
  FormField,
  Input,
  PageHeader,
  SegmentedControl,
  SkeletonTable,
  TopProgressBar,
} from '@driverzone/design-system';
import type { AdminGstInvoiceRequestDto, GstInvoiceStatus } from '@driverzone/contracts';
import { FileText } from 'lucide-react';
import { toErrorState } from '@/lib/api/toErrorState';
import { useGstInvoices, useResolveGstInvoice } from '../hooks/useGstInvoices';

/**
 * GST INVOICES — customers' requests for a GST bill on a completed trip.
 *
 * The team makes the bill outside this panel; this screen is where they find what to make it out
 * to, where to send it, and mark it done. PENDING first, because that is the work.
 */

type Tab = GstInvoiceStatus | 'ALL';

const SEGMENTS = [
  { value: 'PENDING' as const, label: 'Pending' },
  { value: 'SENT' as const, label: 'Sent' },
  { value: 'REJECTED' as const, label: 'Rejected' },
  { value: 'ALL' as const, label: 'All' },
];

const STATUS_TONE: Record<GstInvoiceStatus, BadgeTone> = {
  PENDING: 'warning',
  SENT: 'success',
  REJECTED: 'danger',
};

const STATUS_LABEL: Record<GstInvoiceStatus, string> = {
  PENDING: 'Pending',
  SENT: 'Sent',
  REJECTED: 'Rejected',
};

export function GstInvoicesScreen() {
  const [tab, setTab] = useState<Tab>('PENDING');
  const query = useGstInvoices(tab === 'ALL' ? undefined : tab);
  const [answering, setAnswering] = useState<AdminGstInvoiceRequestDto | null>(null);
  const rows = query.data;

  return (
    <div className="flex flex-col gap-4 pb-16">
      <TopProgressBar active={query.isFetching} />

      <PageHeader
        title="GST Invoices"
        breadcrumbs={[{ label: 'GST Invoices' }]}
        actions={<SegmentedControl value={tab} onValueChange={setTab} segments={SEGMENTS} label="Status" />}
      />

      <p className="max-w-3xl text-xs text-text-subtle">
        Requests from customers for a GST invoice on a completed trip. Make the bill to the details
        below, send it to the WhatsApp number or email given, then mark it <strong>Sent</strong>.
        Customers are told it arrives within the next working days.
      </p>

      <FilterBar>
        <FilterField label="Showing">
          <p className="py-2 text-sm text-text">
            {rows === undefined ? '—' : `${rows.length} request${rows.length === 1 ? '' : 's'}`}
          </p>
        </FilterField>
      </FilterBar>

      <section className="rounded-md border border-border bg-surface p-4">
        <DataState
          loading={query.isLoading}
          error={query.isError ? toErrorState(query.error, () => void query.refetch()) : undefined}
          skeleton={<SkeletonTable rows={5} columns={['1fr', '1fr', '1fr', '1fr', '1fr']} />}
        >
          {rows === undefined || rows.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-6" />}
              title={tab === 'PENDING' ? 'No pending requests' : 'No requests here'}
              description={
                tab === 'PENDING'
                  ? 'New GST invoice requests from customers appear here.'
                  : 'Nothing has been answered with this status yet.'
              }
            />
          ) : (
            <div className={`overflow-x-auto ${query.isFetching ? 'opacity-50 transition-opacity' : ''}`}>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-text-subtle">
                  <tr>
                    <th className="px-4 py-3 font-medium">Requested</th>
                    <th className="px-4 py-3 font-medium">Trip</th>
                    <th className="px-4 py-3 font-medium">Bill to</th>
                    <th className="px-4 py-3 font-medium">Send to</th>
                    <th className="px-4 py-3 font-medium">Fare</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="w-28 px-4 py-3 text-center font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.id} className="align-top hover:bg-surface-hover">
                      <td className="whitespace-nowrap px-4 py-3 text-text-subtle">
                        {new Date(row.created_at).toLocaleString('en-IN', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: 'Asia/Kolkata',
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/bookings/${row.booking_id}`} className="font-medium underline">
                          {row.booking_reference}
                        </Link>
                        <p className="text-xs text-text-subtle">
                          {row.customer.name ?? 'Customer'}
                          {row.customer.phone === null ? '' : ` · ${row.customer.phone}`}
                        </p>
                      </td>
                      <td className="max-w-72 px-4 py-3">
                        <p className="font-medium">{row.legal_name}</p>
                        <p className="font-mono text-xs">{row.gstin}</p>
                        <p className="text-xs text-text-subtle">
                          {row.billing_address}, {row.state_name} – {row.pincode}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {row.send_to_whatsapp === null ? null : <p>WhatsApp {row.send_to_whatsapp}</p>}
                        {row.send_to_email === null ? null : <p>{row.send_to_email}</p>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{row.fare_total.amount_display}</td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                        {row.invoice_number === null ? null : (
                          <p className="mt-1 text-xs text-text-subtle">No. {row.invoice_number}</p>
                        )}
                        {row.admin_note === null ? null : (
                          <p className="mt-1 max-w-48 text-xs text-text-subtle">{row.admin_note}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.status === 'PENDING' ? (
                          <Button size="sm" variant="secondary" onClick={() => setAnswering(row)}>
                            Answer
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataState>
      </section>

      {answering === null ? null : (
        <ResolveDialog request={answering} onClose={() => setAnswering(null)} />
      )}
    </div>
  );
}

/**
 * Sent — with the invoice number, so the customer and the next admin can find the bill — or
 * Rejected, with a reason the customer reads. The server enforces the reason; this says so first.
 */
function ResolveDialog({ request, onClose }: { request: AdminGstInvoiceRequestDto; onClose: () => void }) {
  const resolve = useResolveGstInvoice();
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [note, setNote] = useState('');

  const answer = (status: 'SENT' | 'REJECTED') =>
    resolve.mutate(
      {
        id: request.id,
        body: {
          status,
          ...(status === 'SENT' && invoiceNumber.trim() !== '' ? { invoice_number: invoiceNumber.trim() } : {}),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        },
      },
      { onSuccess: onClose },
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`GST invoice — ${request.booking_reference}`}
      description={`${request.legal_name} · ${request.gstin}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="danger"
            disabled={note.trim() === '' || resolve.isPending}
            onClick={() => answer('REJECTED')}
          >
            Reject
          </Button>
          <Button loading={resolve.isPending} onClick={() => answer('SENT')}>
            Mark as sent
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <FormField label="Invoice number" hint="Shown to the customer once marked sent.">
          {({ id }) => (
            <Input
              id={id}
              value={invoiceNumber}
              maxLength={60}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="e.g. DZ/2026-27/0042"
            />
          )}
        </FormField>
        <FormField label="Note to the customer" hint="Required to reject — say what to fix.">
          {({ id }) => (
            <Input
              id={id}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. The GSTIN does not match the business name"
            />
          )}
        </FormField>
      </div>
    </Dialog>
  );
}
