'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from '@driverzone/design-system';
import { ApiError } from '../api/ApiError';
import { newIdempotencyKey } from '../api/idempotency';
import { withAuth } from '../auth/session';

/**
 * How every authenticated write in the panel is built — the counterpart to `authedQueryOptions`.
 *
 * Deliberately NOT here: optimistic updates. §5 of docs/engineering/frontend-architecture.md
 * allows them only where a rollback is honest — a visibility toggle, yes; anything touching
 * geometry or money, no, because a fare that flickers to the wrong number and corrects itself
 * leaves the admin unable to say which of the two figures was real. That is a per-call judgement,
 * and building it into the factory would make the dishonest case the easy one. Callers that want
 * it pass their own `onMutate`.
 */

export interface ApiMutationInput<TVars, TResult> {
  /**
   * The endpoint call. Receives the access token and, when `idempotent` is set, the key for THIS
   * invocation — see the warning on `mutationFn` below.
   */
  call: (token: string, vars: TVars, idempotencyKey: string) => Promise<TResult>;
  /** Key factories to invalidate once this settles — `keys.zones.all()`, never a literal. */
  invalidates?: readonly QueryKey[];
  /** Toasted on success. Omit for a write whose result is visible on screen anyway. */
  successMessage?: string;
  onSuccess?: (result: TResult, vars: TVars) => void;
}

/**
 * Build the function handed to `useMutation`.
 *
 * Extracted from the hook so the property below can be tested in `node`, where there is no
 * React: `vitest.config.ts` keeps this app's tests DOM-free on purpose.
 *
 * THE IDEMPOTENCY KEY IS GENERATED ONCE PER INVOCATION, OUTSIDE THE CLOSURE `withAuth` REPLAYS.
 * `withAuth` refreshes and retries once on an expired token, and that retry re-runs this closure.
 * Generating the key inside it would send a different key on the replay, making one click look
 * like two unrelated requests to a server whose entire defence against double-charging is that
 * header. One click, one key, however many attempts it takes.
 */
export function buildMutationFn<TVars, TResult>(
  call: ApiMutationInput<TVars, TResult>['call'],
): (vars: TVars) => Promise<TResult> {
  return (vars) => {
    const idempotencyKey = newIdempotencyKey();
    return withAuth((token) => call(token, vars, idempotencyKey));
  };
}

export function useApiMutation<TVars = void, TResult = unknown>({
  call,
  invalidates,
  successMessage,
  onSuccess,
}: ApiMutationInput<TVars, TResult>) {
  const queryClient = useQueryClient();

  return useMutation<TResult, Error, TVars>({
    mutationFn: buildMutationFn(call),

    onSuccess: (result, vars) => {
      if (successMessage !== undefined) toast.success(successMessage);
      onSuccess?.(result, vars);
    },

    onError: (error) => {
      // The server's wording, verbatim, with the request id beside it. Never copy built from
      // `code` — a reason added server-side would render as a fallback string on a client that
      // predates it (docs/engineering/coding-standards.md).
      if (error instanceof ApiError) toast.error(error.message, error.requestId);
      else toast.error(error.message);
    },

    // On settled, not on success: a write that failed with CONFLICT changed nothing here but
    // means the cache is already wrong — something else moved the data, and that is exactly when
    // a stale table is most misleading.
    onSettled: () => {
      for (const key of invalidates ?? []) void queryClient.invalidateQueries({ queryKey: key });
    },

    // `retry: false` is inherited from makeQueryClient and is not overridden here. A retried POST
    // can create two of something, and the user still has the button.
  });
}
