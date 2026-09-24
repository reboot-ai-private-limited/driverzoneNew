'use client';

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { API_BASE_URL } from '@/lib/site';

type Role = 'customer' | 'driver';
type Step = 'details' | 'code' | 'done';

interface Blocker {
  code: string;
  message: string;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly blockers: Blocker[],
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Could not reach DriverZone. Check your connection and try again.', 'NETWORK', []);
  }

  const json = (await response.json().catch(() => null)) as {
    success?: boolean;
    code?: string;
    message?: string;
    data?: unknown;
  } | null;

  if (!response.ok || json?.success !== true) {
    const reasons = (json?.data as { reasons?: Blocker[] } | undefined)?.reasons;
    throw new ApiError(
      json?.message ?? 'Something went wrong. Please try again.',
      json?.code ?? 'UNKNOWN',
      Array.isArray(reasons) ? reasons : [],
    );
  }
  return json.data as T;
}

/** Accepts `98323 49168`, `09832349168`, `+91 98323 49168` — returns E.164 or null. */
function toE164(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

const inputClass =
  'w-full rounded-md border border-border-strong bg-bg px-4 py-3 text-[17px] text-fg outline-none focus:border-fg focus:ring-2 focus:ring-brand';
const primaryButton =
  'inline-flex items-center justify-center rounded-pill bg-danger px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const linkButton =
  'text-[15px] font-medium text-link underline underline-offset-4 disabled:cursor-not-allowed disabled:text-faint disabled:no-underline';

export function DeleteAccountForm(): ReactElement {
  const [step, setStep] = useState<Step>('details');
  const [role, setRole] = useState<Role>('customer');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function sendCode(target: string, channel?: 'SMS'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await post<{ retry_after_seconds: number }>(`/account-deletion/${role}/otp`, {
        mobile_number: target,
        ...(channel === undefined ? {} : { channel }),
      });
      setPhone(target);
      setResendIn(result.retry_after_seconds);
      setNotice(
        channel === 'SMS'
          ? 'If this number has an account, a code is on its way by SMS.'
          : 'If this number has an account, a 6-digit code is on its way on WhatsApp.',
      );
      setStep('code');
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  function onDetails(event: FormEvent): void {
    event.preventDefault();
    const target = toE164(phoneInput);
    if (target === null) {
      setError(new ApiError('Enter a valid 10-digit Indian mobile number.', 'VALIDATION', []));
      return;
    }
    void sendCode(target);
  }

  async function onConfirm(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/account-deletion/${role}/confirm`, { mobile_number: phone, otp: code.trim() });
      setStep('done');
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (step === 'done') {
    return (
      <div className="rounded-xl border border-border bg-bg-sunken p-6" role="status">
        <p className="!text-fg font-semibold">Your account has been deleted.</p>
        <p className="mt-2">
          Your profile and personal data have been removed and you have been signed out on every
          device. You can uninstall the app now.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-bg p-6 sm:p-8">
      {step === 'details' ? (
        <form onSubmit={onDetails} className="space-y-6" noValidate>
          <fieldset>
            <legend className="text-[15px] font-semibold text-fg">Account type</legend>
            <div className="mt-3 flex flex-wrap gap-3">
              {(['customer', 'driver'] as const).map((r) => (
                <label
                  key={r}
                  className={`cursor-pointer rounded-pill border px-5 py-2 text-[15px] font-medium ${
                    role === r ? 'border-fg bg-fg text-on-fg' : 'border-border-strong text-fg'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r}
                    checked={role === r}
                    onChange={() => setRole(r)}
                    className="sr-only"
                  />
                  {r === 'customer' ? 'Customer' : 'Driver'}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="phone" className="block text-[15px] font-semibold text-fg">
              Mobile number on your account
            </label>
            <div className="mt-2 flex items-stretch gap-2">
              <span className="flex items-center rounded-md border border-border bg-bg-sunken px-3 text-fg">
                +91
              </span>
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="98765 43210"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <ErrorBox error={error} />

          <button type="submit" disabled={busy || phoneInput.trim() === ''} className={primaryButton}>
            {busy ? 'Sending…' : 'Send verification code'}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void onConfirm(e)} className="space-y-6" noValidate>
          <p>
            {notice} Enter it below to confirm deletion of the{' '}
            <strong>{role === 'customer' ? 'customer' : 'driver'}</strong> account for{' '}
            <strong>{phone}</strong>.
          </p>

          <div>
            <label htmlFor="otp" className="block text-[15px] font-semibold text-fg">
              Verification code
            </label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className={`${inputClass} mt-2 max-w-xs tracking-[0.3em]`}
            />
          </div>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-1.5 size-4 accent-danger"
            />
            <span className="text-[16px] text-muted">
              I understand this permanently deletes my account and cannot be undone. Any wallet
              credit on the account will be lost.
            </span>
          </label>

          <ErrorBox error={error} />

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <button
              type="submit"
              disabled={busy || code.length !== 6 || !understood}
              className={primaryButton}
            >
              {busy ? 'Deleting…' : 'Delete my account permanently'}
            </button>
            <button
              type="button"
              disabled={busy || resendIn > 0}
              onClick={() => void sendCode(phone, 'SMS')}
              className={linkButton}
            >
              {resendIn > 0 ? `Get code by SMS in ${resendIn}s` : 'Get code by SMS instead'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setStep('details');
                setCode('');
                setError(null);
              }}
              className={linkButton}
            >
              Use a different number
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ErrorBox({ error }: { error: ApiError | null }): ReactElement | null {
  if (error === null) return null;
  return (
    <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 p-4">
      {error.blockers.length > 0 ? (
        <>
          <p className="!text-danger font-semibold">Your account can’t be deleted yet:</p>
          <ul>
            {error.blockers.map((b) => (
              <li key={b.code}>{b.message}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="!text-danger">{error.message}</p>
      )}
    </div>
  );
}
