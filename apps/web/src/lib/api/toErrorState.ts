import type { ErrorStateProps } from '@driverzone/design-system';
import { ApiError, NetworkError } from './ApiError';

/**
 * Turn a thrown error into what `<ErrorState>` should render.
 *
 * The whole taxonomy in one place, because the alternative is every screen deciding
 * independently whether a FORBIDDEN gets a retry button — and most of them getting it wrong,
 * since the obvious thing to do with an error is offer a retry.
 *
 * See docs/engineering/frontend-architecture.md §What each error code renders.
 */
export function toErrorState(error: unknown, retry?: () => void): ErrorStateProps {
  if (error instanceof NetworkError) {
    return {
      message: error.message,
      title: 'Cannot reach the server',
      ...(retry && { onRetry: retry }),
    };
  }

  if (!(error instanceof ApiError)) {
    return {
      message: 'Something went wrong. Please try again.',
      ...(retry && { onRetry: retry }),
    };
  }

  const base = { message: error.message, requestId: error.requestId };

  switch (error.code) {
    case 'FORBIDDEN':
      // No retry, deliberately. Retrying cannot grant a permission, and a button that
      // cannot work invites four clicks and the conclusion that the tool is broken.
      return { ...base, title: 'Not permitted' };

    case 'NOT_FOUND':
      return { ...base, title: 'Not found' };

    case 'ZONE_CONFIG_FAULT':
    case 'AMBIGUOUS_ZONE_MATCH':
      // Faults that page someone (docs/LLD/admin-panel.md §Alerts). Saying so is true and
      // stops an admin trying to fix it by reloading.
      return {
        ...base,
        title: 'Configuration fault',
        message: `${error.message} The engineering team has been alerted.`,
      };

    default:
      return {
        ...base,
        ...(error.isRetryable && retry ? { onRetry: retry } : {}),
      };
  }
}
