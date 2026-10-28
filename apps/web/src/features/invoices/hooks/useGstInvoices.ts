import { useQuery } from '@tanstack/react-query';
import type {
  AdminGstInvoiceRequestDto,
  GstInvoiceStatus,
  ResolveGstInvoiceRequest,
} from '@driverzone/contracts';
import { request } from '@/lib/api/client';
import { authedQueryOptions } from '@/lib/query/factory';
import { useApiMutation } from '@/lib/query/mutation';

/**
 * `/admin/gst-invoices` — customers' GST invoice requests. The status filter is applied by the
 * server; the list is capped at 200, which at a few requests a day is the whole queue.
 */
export function useGstInvoices(status: GstInvoiceStatus | undefined) {
  return useQuery(
    authedQueryOptions({
      queryKey: ['admin', 'gst-invoices', { status }],
      fetch: (token, signal) =>
        request<AdminGstInvoiceRequestDto[]>('/admin/gst-invoices', {
          token,
          signal,
          query: status === undefined ? {} : { status },
        }),
      // A queue more than one person works; a request someone else answered should not look open.
      staleTime: 1000 * 30,
    }),
  );
}

export function useResolveGstInvoice() {
  return useApiMutation<{ id: string; body: ResolveGstInvoiceRequest }, AdminGstInvoiceRequestDto>({
    call: (token, { id, body }) =>
      request<AdminGstInvoiceRequestDto>(`/admin/gst-invoices/${id}`, { method: 'PATCH', token, body }),
    invalidates: [['admin', 'gst-invoices']],
  });
}
