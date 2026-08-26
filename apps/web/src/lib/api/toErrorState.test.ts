import { describe, expect, it, vi } from 'vitest';
import type { HttpErrorBody } from '@driverzone/contracts';
import { ApiError, NetworkError } from './ApiError';
import { toErrorState } from './toErrorState';

function apiError(status: number, code: string, message = 'Something happened.'): ApiError {
  return new ApiError({
    success: false,
    statusCode: status,
    code,
    message,
    request: { method: 'GET', url: '/admin/zones', requestId: 'req_01J' },
  } as HttpErrorBody);
}

const retry = vi.fn();

describe('the error taxonomy', () => {
  it('renders the SERVER message verbatim, never a rewritten one', () => {
    const state = toErrorState(apiError(409, 'CONFLICT', 'Prices have updated.'), retry);
    expect(state.message).toBe('Prices have updated.');
  });

  it('carries the request id through, so support can be handed one', () => {
    expect(toErrorState(apiError(500, 'INTERNAL')).requestId).toBe('req_01J');
  });

  it('offers NO retry on FORBIDDEN — retrying cannot grant a permission', () => {
    expect(toErrorState(apiError(403, 'FORBIDDEN'), retry).onRetry).toBeUndefined();
  });

  it('offers no retry on NOT_FOUND either', () => {
    expect(toErrorState(apiError(404, 'NOT_FOUND'), retry).onRetry).toBeUndefined();
  });

  it('offers no retry on a validation failure — the input is what is wrong', () => {
    expect(toErrorState(apiError(400, 'VALIDATION_FAILED'), retry).onRetry).toBeUndefined();
  });

  it('offers a retry on a 5xx', () => {
    expect(toErrorState(apiError(500, 'INTERNAL'), retry).onRetry).toBeDefined();
  });

  it('says a config fault has been escalated, because it has', () => {
    const state = toErrorState(apiError(500, 'ZONE_CONFIG_FAULT', 'A zone resolved oddly.'));
    expect(state.title).toBe('Configuration fault');
    expect(state.message).toContain('has been alerted');
  });

  it('distinguishes an unreachable server from a server that answered', () => {
    const state = toErrorState(new NetworkError(), retry);
    expect(state.title).toBe('Cannot reach the server');
    expect(state.requestId).toBeUndefined();
    expect(state.onRetry).toBeDefined();
  });

  it('does not leak a raw thrown value into the UI', () => {
    const state = toErrorState(new Error('mongo exploded: connection string ...'), retry);
    expect(state.message).toBe('Something went wrong. Please try again.');
  });
});

describe('ApiError', () => {
  it('reads retry_after_seconds off a 429 so the UI can count down', () => {
    const error = new ApiError({
      success: false,
      statusCode: 429,
      code: 'OTP_COOLDOWN_ACTIVE',
      message: 'Please wait.',
      request: { method: 'POST', url: '/admin/auth/otp/send', requestId: 'req_01J' },
      data: { retry_after_seconds: 41 },
    } as HttpErrorBody);
    expect(error.retryAfterSeconds).toBe(41);
  });

  it('treats a revoked session as unrecoverable, unlike an ordinary expiry', () => {
    expect(apiError(401, 'UNAUTHENTICATED').isAuthExpiry).toBe(true);
    expect(apiError(401, 'SESSION_REVOKED').isAuthExpiry).toBe(false);
  });

  it('never marks a 4xx retryable', () => {
    for (const status of [400, 401, 403, 404, 409, 429]) {
      expect(apiError(status, 'X').isRetryable).toBe(false);
    }
    expect(apiError(500, 'INTERNAL').isRetryable).toBe(true);
  });
});
