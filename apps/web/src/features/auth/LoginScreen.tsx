'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button, FormField, Input, OtpInput } from '@driverzone/design-system';
import { ApiError } from '@/lib/api/ApiError';
import { authApi } from '@/lib/api/endpoints/auth';
import { useSession } from '@/lib/auth/SessionProvider';
import { destinationAfterLogin } from '@/lib/auth/next-path';

type Step = 'phone' | 'otp';

/**
 * Phone → OTP, per docs/LLD/auth.md.
 *
 * The critical property: `otp/send` returns an IDENTICAL 200 whether or not the number belongs
 * to a provisioned admin. So this screen advances to the OTP step unconditionally and never
 * says anything about whether the number is known. Doing otherwise turns the endpoint into a
 * directory of who works here — walk a number range and keep whatever does not error.
 */
export function LoginScreen() {
  const router = useRouter();
  const { signIn } = useSession();

  const [step, setStep] = useState<Step>('phone');
  const [mobile, setMobile] = useState('+91');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submitted = useRef(false);

  const send = async (): Promise<void> => {
    setPending(true);
    setError(undefined);
    try {
      const { retry_after_seconds } = await authApi.sendOtp({ mobile_number: mobile });
      setCooldown(retry_after_seconds);
      setStep('otp');
    } catch (cause) {
      // The server's wording, never ours. A 429 here carries its own countdown.
      setError(cause instanceof Error ? cause.message : 'Could not send the code.');
      if (cause instanceof ApiError) setCooldown(cause.retryAfterSeconds ?? 0);
    } finally {
      setPending(false);
    }
  };

  const verify = async (code: string): Promise<void> => {
    setPending(true);
    setError(undefined);
    try {
      await signIn(mobile, code);
      // Back to whatever the panel gate parked in `?next=`, or the landing screen. The path is
      // validated as same-origin first — an admin login that will redirect anywhere on request
      // is a phishing link wearing this app's hostname.
      router.replace(destinationAfterLogin());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign you in.');
      // Five wrong attempts burn the challenge and there is no "one more try" — the next move
      // is a fresh send, so clear the boxes rather than leaving a dead code in them.
      setOtp('');
      submitted.current = false;
    } finally {
      setPending(false);
    }
  };

  // Six digits is the whole input; making the admin then reach for a button is friction with
  // no purpose. The ref guards against re-submitting the same code on a re-render.
  useEffect(() => {
    if (step === 'otp' && otp.length === 6 && !submitted.current) {
      submitted.current = true;
      void verify(otp);
    }
    // `verify` is recreated every render and would restart this on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step]);

  return (
    <main className="min-h-screen grid place-items-center bg-surface-sunken p-4">
      <div className="w-full max-w-sm flex flex-col gap-6 bg-surface border border-border rounded-md p-6">
        <div className="flex flex-col gap-1">
          <span className="size-10 rounded-md bg-accent grid place-items-center text-accent-ink font-bold">
            DZ
          </span>
          <h1 className="mt-2 text-lg font-semibold text-text">DriverZone Admin</h1>
          <p className="text-xs text-text-subtle">
            {step === 'phone'
              ? 'Sign in with your registered mobile number.'
              : `We sent a 6-digit code to ${mobile}.`}
          </p>
        </div>

        {step === 'phone' ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <FormField label="Mobile number" error={error} required>
              {({ id, invalid, describedBy }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  aria-describedby={describedBy}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="+919876543210"
                  className="tnum"
                />
              )}
            </FormField>
            <Button type="submit" variant="primary" loading={pending} disabled={mobile.length < 10}>
              Send code
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <FormField label="Verification code" error={error}>
              {() => (
                <OtpInput
                  value={otp}
                  onChange={setOtp}
                  disabled={pending}
                  invalid={error !== undefined}
                  autoFocus
                />
              )}
            </FormField>

            <div className="flex items-center justify-between">
              <Button
                size="sm"
                variant="ghost"
                icon={<ArrowLeft aria-hidden className="size-3.5" />}
                onClick={() => {
                  setStep('phone');
                  setOtp('');
                  setError(undefined);
                }}
              >
                Change number
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={cooldown > 0 || pending}
                onClick={() => void send()}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
