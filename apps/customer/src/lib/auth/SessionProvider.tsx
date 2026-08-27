import { type ReactElement, createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as session from './session';

/**
 * React's view of `session.ts`. The module owns the state; this only subscribes to it.
 *
 * Splitting them that way is what lets `client.ts` and the query layer read the access token
 * without importing React, and keeps the refresh timer out of a component's lifecycle — a timer
 * that unmounts with a screen is a token that stops renewing when the customer opens a map.
 */
const SessionContext = createContext<session.SessionState>(session.getState());

export function SessionProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, setState] = useState<session.SessionState>(session.getState);

  useEffect(() => session.subscribe(setState), []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): session.SessionState {
  return useContext(SessionContext);
}
