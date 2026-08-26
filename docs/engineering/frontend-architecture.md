# Frontend Architecture

How `apps/web` is built. The API's counterpart to this file is
[`module-anatomy.md`](module-anatomy.md); what the panel _looks_ like is
[`design-language.md`](design-language.md), deliberately a separate file because the two change
for different reasons.

`apps/web` is the **admin panel** — the screens in [`../LLD/admin-panel.md`](../LLD/admin-panel.md),
Phase 3 of [`../LLD/roadmap.md`](../LLD/roadmap.md). The customer and driver apps are React
Native and share nothing with this file except `@driverzone/contracts` and the design tokens.

---

## The shape of the app

**The panel is a client-side application that Next serves.** Every screen is a client component;
no page fetches data on the server, and no Server Component touches the API.

That is a decision, not an accident, and it follows from auth. [`../LLD/auth.md`](../LLD/auth.md)
gives an admin an access token **in the response body** and a refresh token in an httpOnly cookie
**scoped to `/api/admin/auth`**. The access token therefore lives in the browser, and a Server
Component has no way to obtain one. Making RSC work would mean Next owning a second session — a
BFF — which is a second session store, a second set of expiry rules, and a second thing to get
wrong, in exchange for server rendering an internal tool used by a handful of ops staff. See
[`../decision-log.md`](../decision-log.md).

What Next is still doing for us: the App Router's file-based routing and layouts, code splitting
per route, and `output: 'standalone'` for a small production image. Those are worth having on
their own.

```
browser ──── Authorization: Bearer ────►  api:4000/api/admin/zones
        └─── Cookie: dz_refresh ───────►  api:4000/api/admin/auth/refresh
```

### One deployment constraint falls out of this

The refresh cookie is `SameSite=Strict` and is set on the **API's** origin. So the panel must be
served from the same registrable domain as the API — `admin.driverzone.in` alongside
`api.driverzone.in` is fine; putting the panel on a different domain means the cookie is never
sent and login silently never completes. Local development is unaffected: `localhost:3000` and
`localhost:4000` are the same site, because ports do not enter into it. Recorded also in
[`build-and-deploy.md`](build-and-deploy.md).

---

## Directory contract

```
apps/web/src/
  app/                      ROUTES ONLY
    (auth)/login/page.tsx
    (panel)/layout.tsx      the shell; gates on session
    (panel)/zones/page.tsx
    layout.tsx  loading.tsx  error.tsx  not-found.tsx
  lib/
    api/client.ts           fetch → envelope → typed data or ApiError
    api/endpoints/auth.ts   one file per API module
    api/endpoints/zones.ts
    api/idempotency.ts      Idempotency-Key values
    auth/session.ts         the access token, refresh, boot restore
    query/client.ts         QueryClient defaults
    query/keys.ts           the key factory
    query/factory.ts        authedQueryOptions — how every read is built
    query/mutation.ts       useApiMutation — how every write is built
    hooks/scheduling.ts     debounce and throttle, with no React in them
    hooks/timing.ts         every debounce interval in the panel
    hooks/useFilterParams.ts  filter state, kept in the URL
    format.ts               money, distance, Asia/Kolkata timestamps
  features/<module>/        hooks/ and components/ for one API module
  components/               app-level shared: AppShell, SideNav, TopBar, DataState
```

Two rules hold this together:

**`app/` holds routing and nothing else.** A `page.tsx` imports one screen component from
`features/` and renders it. No data fetching, no layout logic, no business rules. The reason is
that App Router conventions are Next's, and they change — file collocation in `app/` means a
framework upgrade touches feature code.

**`lib/api/endpoints/` mirrors `apps/api/src/modules/` one-for-one**, and so does `features/`.
`zones` on the server is `zones` here. When `bookings` ships on the API its filename on the
frontend is already decided, and "where does this call go" is never a question.

Naming follows [`coding-standards.md`](coding-standards.md) with one exception noted there:
component files are `PascalCase.tsx`, hooks are `useThing.ts`.

---

## The API client

Every request goes through one function in `lib/api/client.ts`, whose entire job is the envelope
from [`../LLD/api-contracts.md`](../LLD/api-contracts.md).

```ts
const zones = await api.get<ListZonesResponse>('/admin/zones'); // already unwrapped
```

- **Base URL** comes from `NEXT_PUBLIC_API_BASE_URL`, default `http://localhost:4000/api`. It is
  inlined at build time — see the note in `apps/web/Dockerfile`; pointing an image at a different
  API is a rebuild, not a restart.
- **`success: true`** → return `data`, typed from `@driverzone/contracts`. Callers never see the
  envelope.
- **`success: false`** → throw `ApiError`:

  ```ts
  class ApiError extends Error {
    status: number;
    code: FaultCode; // control flow reads this
    message: string; // the UI renders this, verbatim
    requestId: string; // support quotes this
    data?: unknown; // field errors, retry_after_seconds
  }
  ```

- **`credentials: 'include'` only on `/admin/auth/*`.** Everywhere else the bearer _is_ the
  credential, and the cookie is path-scoped away from those routes on purpose — a token that
  rides along on hundreds of unrelated requests has hundreds of chances to leak. Sending
  credentials everywhere would quietly undo that.
- **`Idempotency-Key`** comes from `lib/api/idempotency.ts` and is applied by `useApiMutation`,
  not by hand at a call site. It is required on every POST that creates or moves money. See
  §Every read and every write goes through a factory for the one rule about its lifetime.
- **`signal`** is threaded through every READ (`zonesApi.list(token, query, signal)`). Writes do
  not take one: a request that has already reached the server cannot be un-sent, and aborting it
  only loses us the answer to something that happened anyway.

### `available: false` is not an error

Zone-resolution outcomes return **HTTP 200** with `available: false`
([`../LLD/zone-resolution.md`](../LLD/zone-resolution.md)). The client returns them as ordinary
data. A screen renders the server's `message` in an informational state — never through the error
path, never as a thrown `ApiError`.

### Clients render `message`, never `code`

`message` is customer-safe and displayable verbatim. Building copy from `code` in the frontend
means a reason added server-side renders as a blank or a fallback string on anything that predates
it. This matters most for the mobile apps, where the old version is a store binary — but the rule
is the same here, and the panel is where it gets set.

`code` is for **control flow only**: which state to render, whether to offer a retry, whether to
redirect.

---

## Session

Implements [`../LLD/auth.md`](../LLD/auth.md) §Token lifecycle. There are four moving parts and
one of them is genuinely dangerous.

**The access token lives in a module-level variable. Never `localStorage`.** The refresh token is
httpOnly precisely so an XSS cannot read it; putting the access token somewhere an XSS _can_ read
gives most of that back. In memory it dies with the tab.

**Boot restore is a silent refresh.** On load there is no token, so the app calls
`POST /admin/auth/refresh` with no body — the path-scoped cookie is what authenticates it. A 200
means we are signed in; a 401 means we are not. This is the only session-restore mechanism there
is.

> The consequence is that **a hard reload always costs one round-trip before anything renders**.
> That is the correct trade for a token that cannot be persisted, and the shell is built for it:
> a boot skeleton, never a flash of the login screen followed by the real page.

**Refresh is proactive, on a timer at ~12 minutes** — 80% of the 15-minute TTL — not reactively
on a 401. `auth.md` requires this; for the panel it means an admin mid-form does not hit an
expired token at the moment they submit.

**Refresh is single-flight.** Concurrent 401s share one in-flight refresh promise.

> This is the one part of the client that is dangerous to get wrong. Refresh tokens **rotate**,
> and `auth.md` defines presenting an already-used one as theft: it revokes the entire session
> family. A screen with six queries that fires six refreshes has five of them present a spent
> token, and the admin is logged out and told to sign in again — by their own client, for doing
> nothing wrong. One promise, shared.

Refresh failure clears the token and routes to `/login`. Not a toast, not a retry, not an error
screen.

**That routing is a subscription, not a return value.** The proactive refresh runs on a timer with
nothing awaiting it, so when it fails there is no call stack to throw into: `session.subscribe`
is how `SessionProvider` hears the token go to `null` and turns it into `anonymous`, which the
panel gate already redirects from. It also clears the query cache on the way out — an ops laptop
is a shared machine, and rows fetched under one admin's permissions should not be sitting in
memory for the next one. A deliberate sign-out takes the same path, deliberately: two copies of
"what happens when the session ends" is how they stop agreeing.

---

## Server state

TanStack Query. `tech-choices.md` parked it until the panel actually needed it; the zone editor —
debounced validation on every geometry change, invalidation across a list and a detail view, a
map that must not blank on refetch — is that point.

There is **no client state library**. What little cross-screen state exists (nav pinned, active
filters) lives in URL search params or a context, and both are better places for it.

### Every read and every write goes through a factory

A feature hook supplies a key and a call. Everything else — the token, the abort signal,
`keepPreviousData`, retry, invalidation, the failure toast — is decided once:

```ts
// lib/query/factory.ts
useQuery(authedQueryOptions({ queryKey: keys.zones.list(query), fetch: (token, signal) => … }));

// lib/query/mutation.ts
useApiMutation({ call, invalidates: [keys.zones.all()], successMessage: 'Zone deactivated.' });
```

This exists because a hand-written `useQuery` gets three things wrong, and only the third is
visible when it happens:

1. **It forgets `withAuth`.** The 401 then lands in the retry logic, which correctly refuses to
   retry a 4xx — so the screen says "unauthenticated" for an admin whose session is valid and one
   refresh away.
2. **It drops the `signal`.** TanStack hands one to every `queryFn`. Ignoring it leaves superseded
   requests running, and their answers racing — for the zone editor's live validation, the verdict
   shown ends up being whichever reply arrived last rather than the one for the shape on screen.
3. **It omits `keepPreviousData`**, and the table empties on every keystroke.

`liveQueryOptions` is the same thing for operational data: `staleTime: 0` plus a `refetchInterval`.
It leaves `refetchIntervalInBackground` at its default of `false`, so a hidden tab stops polling
entirely — an ops laptop left open overnight is otherwise thousands of requests nobody reads.

**Writes are not optimistic by default.** §5 below allows optimism only where a rollback is
honest, which is a per-call judgement; building it into the factory would make the dishonest case
the easy one. What the factory does own is the idempotency key, and one rule about it:

> **One click, one key — however many attempts it takes.** `withAuth` refreshes and replays once
> on an expired token, and that replay re-runs the same closure. A key generated per _attempt_
> makes that replay look to the server like a second, unrelated request, which is the exact
> double-write `Idempotency-Key` exists to prevent. `buildMutationFn` generates it outside the
> closure, and `lib/query/mutation.test.ts` is there to keep it that way.

### Debouncing and throttling

`lib/hooks/` — `useDebouncedValue`, `useDebouncedCallback`, `useThrottledCallback`, over plain
`debounce`/`throttle` in `scheduling.ts` that have no React in them (which is what makes them
testable in this app's DOM-free Vitest setup).

**Every interval lives in `lib/hooks/timing.ts`**, never as a literal at a call site:
`SEARCH_DEBOUNCE_MS` 250, `VALIDATE_DEBOUNCE_MS` 400 (fixed by
[`../LLD/admin-panel.md`](../LLD/admin-panel.md) §Live validation), `MAP_THROTTLE_MS` 100.

Debounce for input the user is still producing; throttle for a continuous gesture that must keep
updating _while_ it happens — a map pan debounced is a map that does nothing until you let go.

> Debouncing here is about **not creating the query key**. TanStack already de-duplicates
> identical in-flight keys, so debouncing to "avoid duplicate requests" would be cargo cult. What
> it prevents is eight _different_ keys for eight keystrokes, each a real request.

### Filters live in the URL

`lib/hooks/useFilterParams.ts` puts search, type, sort and page in the query string. A filtered
table then survives a reload, and an ops person can paste the exact view they are asking about
instead of describing it.

`router.replace`, never `push` — every keystroke is a state change, and pushing them turns the
back button into an undo history of typing. An empty filter is an **absent** parameter, not `?q=`.
The search input keeps its own immediate value and writes the debounced one to the URL: a text
field that echoes a quarter-second late feels broken no matter how correct it is.

Reading `useSearchParams` opts a route out of static prerendering unless it sits inside a Suspense
boundary — which is why `(panel)/zones/page.tsx` has one. Without it the build fails.

### Query keys

`lib/query/keys.ts` is a factory, never string literals at call sites:

```ts
keys.zones.all(); // ['zones']
keys.zones.list(filters); // ['zones', 'list', filters]
keys.zones.detail(id); // ['zones', 'detail', id]
```

A mutation invalidates `keys.zones.all()` and every dependent view updates. With literals
scattered across files, one of them is eventually spelled differently and a screen goes stale in
a way nobody reproduces.

### Staleness

| Data                                                         | `staleTime`             | Refetch on focus      |
| ------------------------------------------------------------ | ----------------------- | --------------------- |
| Zone / package configuration                                 | 30 s                    | yes                   |
| The signed-in admin's own profile                            | 5 min                   | no                    |
| Live operational data (bookings, dispatch, driver locations) | 0                       | yes, plus an interval |
| Validation, previews, anything computed from user input      | not cached — a mutation | —                     |

Configuration changes rarely and is edited by a small number of people who need to see each
other's work; 30 seconds with a focus refetch fits that. Live operational data has no useful
stale window at all.

### Retries

**Never retry a 4xx.** A retried `VALIDATION_FAILED` is three identical failures and a slower
error message. Retry 5xx twice with backoff.

401 never reaches the retry logic — the client's refresh path handles it and replays the request
once.

---

## The loading system

Every data surface is in exactly one of four states, and goes through `<DataState>`:

```
loading  →  error  →  empty  →  ready
```

A screen that handles three of them is unfinished. `DataState` exists so that is checkable by
looking, rather than a convention that decays.

**1. Skeletons, not spinners.** The skeleton reproduces the real geometry — table rows at the
real column widths, a field list at the real row count. A spinner is an admission that we do not
know what is coming; we almost always do.

**2. No full-page loaders.** `(panel)/loading.tsx` renders the shell with a skeleton body.
Navigating within the panel never blanks the chrome, because the chrome is not what is loading.

**3. A background refetch is not a loading state.** Initial load gets skeletons. `isFetching` over
data that is already on screen gets a 2px progress bar at the top and nothing else. The row an
admin is reading must not vanish underneath them every thirty seconds.

**4. Filters and pagination keep the previous page.** `placeholderData: keepPreviousData`, for the
same reason — a table that empties and refills on every keystroke is unusable.

**5. Optimistic updates only where rollback is honest.** A visibility toggle, yes. Anything
touching geometry or money, no: a fare that flickers to the wrong number and corrects itself is
worse than one that takes 300 ms, because the admin cannot tell which of the two figures was real.

**6. Errors show the server's `message`, with the request id.** `RequestMeta.requestId` is
returned on every response and in the `x-request-id` header specifically so it can be quoted to
support. The error state renders it in small mono type with a copy button. That is the whole
reason it is safe to display.

**7. Toasts are for mutations.** A read never toasts. A failed read renders an error state where
the data would have been; a toast for it is a notification about something the user is already
looking at.

### What each error code renders

| Code                                 | Surface                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `UNAUTHENTICATED`, `SESSION_REVOKED` | silent refresh, then `/login`. Never visible as an error.                            |
| `FORBIDDEN`                          | a "not permitted" state, **with no retry button** — retrying cannot help             |
| `VALIDATION_FAILED`                  | field-level, from `data`, beside the offending input                                 |
| `RATE_LIMITED`, `OTP_*`              | **no retry button** — a countdown from `ApiError.retryAfterSeconds`                  |
| `NOT_FOUND`                          | an empty state naming what was not found, with a way back                            |
| `CONFLICT`                           | the server's `message`, and a retry that means **refetch** — the data moved under us |
| `INTERNAL`, 5xx                      | retryable, request id prominent                                                      |

`ZONE_CONFIG_FAULT` and `AMBIGUOUS_ZONE_MATCH` are faults that page someone
([`../LLD/admin-panel.md`](../LLD/admin-panel.md) §Alerts). They render as errors like any other,
but the copy should say the team has been alerted, because it has.

---

## Styling

Tailwind v4, themed from `@driverzone/design-system`. The mechanics:

- `apps/web/src/app/globals.css` imports `tailwindcss`, then the design system's `theme.css`.
- It must also declare `@source "../../../../packages/design-system/src"`. **Without it, every
  class used inside a design-system component is absent from the generated CSS and the
  primitives render unstyled** — a failure that looks like a broken build rather than a missing
  line of config.
- `postcss.config.mjs` loads `@tailwindcss/postcss`. Tailwind v4 has no `tailwind.config.js`; the
  theme is CSS.

Components come from `@driverzone/design-system`. What goes there versus in `apps/web` is in
[`shared-packages.md`](shared-packages.md); the short version is that anything with a name from
[`design-language.md`](design-language.md)'s inventory is shared, and anything that knows what a
zone is stays in `features/`.

---

## Environment

| Variable                   | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | Where the browser calls the API. Inlined at build time. |

`NEXT_PUBLIC_*` is inlined into the client bundle at build time, which makes the image
environment-specific by design. It is a build arg in `apps/web/Dockerfile`, not runtime env,
because passing it at `docker run` would look like it worked and change nothing.

Nothing secret can go here. Every `NEXT_PUBLIC_` value ships to every browser.

---

## Testing

Per [`testing.md`](testing.md). For the frontend specifically:

- **The token guards in `@driverzone/design-system` run on every build** and are the highest-value
  tests in the frontend — see [`design-language.md`](design-language.md) §Guards.
- Pure logic — the money and date formatters, the session's refresh scheduling, `ApiError`
  parsing — is unit tested with Vitest. These are where a bug is silent.
- Components are not snapshot tested. A snapshot of a `<Button>` fails on every legitimate
  change and passes on every regression that does not alter markup.
