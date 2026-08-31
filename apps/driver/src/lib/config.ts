/**
 * `EXPO_PUBLIC_*` is inlined into the bundle at build time, exactly like `NEXT_PUBLIC_*` in
 * apps/web — so nothing secret belongs here, and pointing a build at a different API is a
 * rebuild rather than a restart.
 *
 * On a physical phone running Expo Go, `localhost` is the PHONE, not your machine. Set
 * `EXPO_PUBLIC_API_BASE_URL=http://<your-lan-ip>:4000/api` in `apps/driver/.env` — see
 * `.env.example`.
 */
export const API_BASE_URL = process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'http://localhost:4000/api';

/** Every driver route the app calls is namespaced under this (apps/api/src/routes.ts). */
export const ROLE_PREFIX = '/driver';
