'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AdminProfileDto } from '@driverzone/contracts';
import { authApi } from '../api/endpoints/auth';
import * as session from './session';

export type SessionStatus = 'booting' | 'authenticated' | 'anonymous' | 'unreachable';

interface SessionValue {
  status: SessionStatus;
  admin: AdminProfileDto | null;
  signIn: (mobileNumber: string, otp: string) => Promise<void>;
  signOut: () => Promise<void>;
  retryBoot: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Wraps the session module in React state.
 *
 * The module is the source of truth — it owns the token, the timer and the single-flight
 * refresh, all of which must work identically whether or not React has rendered. This only
 * mirrors the parts a component needs to branch on.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('booting');
  const [admin, setAdmin] = useState<AdminProfileDto | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Boot restore IS a silent refresh — there is no stored token to read. This is why the
    // shell shows a skeleton on load rather than a flash of the login screen.
    void (async () => {
      try {
        const restored = await session.restore();
        if (cancelled) return;
        if (!restored) {
          setStatus('anonymous');
          return;
        }
        const profile = await session.withAuth(authApi.profile);
        if (cancelled) return;
        setAdmin(profile);
        setStatus('authenticated');
      } catch {
        // `restore` only throws when the server is unreachable — a 401 resolves to false.
        // "Cannot reach the API" and "not signed in" need different screens: bouncing to a
        // login form that will also fail helps nobody.
        if (!cancelled) setStatus('unreachable');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootAttempt]);

  const signIn = useCallback(async (mobileNumber: string, otp: string) => {
    await session.signIn(mobileNumber, otp);
    setAdmin(await session.withAuth(authApi.profile));
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    await session.signOut();
    setAdmin(null);
    setStatus('anonymous');
  }, []);

  const retryBoot = useCallback(() => {
    setStatus('booting');
    setBootAttempt((n) => n + 1);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ status, admin, signIn, signOut, retryBoot }),
    [status, admin, signIn, signOut, retryBoot],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
