# Decision Log

Decisions that have been **made**, newest first, with what they replaced and what they cost.

Three files cover decisions and they do not overlap:

| File                                                         | Answers                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [`LLD/open-questions.md`](LLD/open-questions.md)             | What is **not yet decided** — assumptions A1–A12 and the open items that block build |
| [`engineering/tech-choices.md`](engineering/tech-choices.md) | **Current state**: what we use and why, written in the present tense                 |
| this file                                                    | **History**: when it changed, what it replaced, what was rejected                    |

When an open question closes: add an entry here, rewrite `tech-choices.md` (or the relevant
LLD doc) to describe the new present, and strike the item from `open-questions.md`. This log
is append-only — entries are never edited to match a later reversal. A reversal is a new entry
that references the old one.

Keep entries short. If the reasoning needs more than a paragraph it belongs in a doc, and the
entry links to it.

---

## 2026-09-10 — The driver's package share is a flat amount, not a percentage

**Decision:** `driverCommissionBps` (7500 = 75% of the subtotal) becomes `driverAmountPaise` — a
flat rupee amount the driver is paid for the package, in paise. On outstation it is a **day
rate**: `computeOutstationFare` multiplies it by the same IST day count as the band fare, so a
driver away three days is paid three times. The company's share stays derived — `subtotal −
driver`, never stored. `splitFare` keeps a runtime clamp (driver capped at the fare, company
floored at zero) as a backstop; the admin API refuses to save an amount above the package's own
fare, checked against the cheaper of the two directions.

**Why:** Under a rate, the driver's payout moved every time a pickup fee or a night surcharge
landed on the same trip, so "what does this job pay" could not be answered before the trip was
priced. Ops wanted to set the number a driver earns for a job.

**Consequences:** The company now absorbs all the variance — every surcharge, paid pickup zone
and the insurance line accrues entirely to it, where a rate used to split them. `FareSplit` keeps
both `driverAmountPaise` (configured, day-multiplied) and `driverPaise` (actually paid) so a
package priced below its own payout is visible in stored data — `pricing` is pure and does not
log. Existing packages are converted by `migrateCommissionBpsToAmount.ts`:
`round(fare × bps / 10000)` against the base / one-way fare, which keeps a same-day trip's driver
payout identical and hands the company the difference on longer or surcharged trips.

**Rejected:** a flat amount that does *not* scale with outstation days — it would pay a driver
once for a job that took three days, the exact failure the fare-side day multiplier was
introduced to fix.

---

## 2026-09-10 — FAQs are their own module, and the cash charges are written down in them

**Decision:** A `faq` module (tier 0) owns an ordered list of admin-authored question/answer pairs
with a per-entry `isPublished` flag. `GET/PUT /admin/faq` edit it from a panel on the settings
page; `GET /customer/faq` and `GET /driver/faq` return the published entries — the same list to
both apps — which each app renders at `info/faqs` and caches on disk. The customer fare sheet's
food-and-stay warning links there.

**Why:** The driver's food and a place to stay on a long trip are settled in cash, are not fare
lines, and had no stated amount anywhere in the product — the fare sheet said only that the
customer would "settle that directly with the driver". Ops needed to publish those figures, and
change them, without a deploy.

**Why not a settings key:** the registry is scalar by design (`SettingValue = number |
TimeWindow`) and the admin form renders one input per `unit`; `setting.registry.ts` already says a
list-valued setting "needs its own admin form control". A variable-length, reorderable,
per-row-publishable list of prose is not a tunable number. The amounts therefore live in the
answer text an admin types, not in a priced field — nothing computes with them, and the day
something needs to, that value belongs in the registry instead.

**Consequences:** The write replaces the whole list, so `sort_order` is assigned server-side from
array position and a stored id absent from the request is deleted — one drag is one request, but a
stale page could delete rows it never knew about. Mitigated three ways: the use case rejects a
list naming an id that no longer exists (422 `FAQ_NOT_FOUND`), the panel confirms before sending a
shorter list, and the audit row carries the whole list either side of the save, which is the only
record of deleted text. Reads are token-gated like every other app route, so a signed-out user
cannot see the FAQs; both entry points are behind login today, and making them public would be
the first public content GET in this API.

**Also:** the settings page now has two save buttons — the registry fields batch into one PATCH
because the API checks cross-key invariants against the whole configuration, and the FAQs share
none of that. Each is labelled for what it covers and the FAQ panel's dirty state stays out of the
page counter.

**Rejected:** a dedicated FAQs screen in the admin nav. It is the same kind of thing as the fields
above it — something ops changes without a deploy — and it belongs next to the charges it explains.

---

## 2026-09-07 — Road distance moves from self-hosted OSRM to the Google Routes API

**Decision:** `selectRoadDistance()` now prefers `GoogleRoadDistance` (Compute Routes, Essentials
SKU) when `GOOGLE_ROUTES_API_KEY` is set. `OsrmRoadDistance` is retained, tested and reachable
via `OSRM_BASE_URL`, but no compose file starts an `osrm` service any more. Every adapter is
wrapped in `CachingRoadDistance`, and `CreateQuoteUseCase` no longer calls the router at all for
an in-city trip — road distance only decides outstation bands, and in-city outranks outstation
unconditionally.

**This reverses [the infrastructure choice in `tech-choices.md` §OSRM](engineering/tech-choices.md).**
That choice was right on cost per call and wrong on total cost here: the pilot VM cannot spare
the RAM to run an OSRM India extract, and building/shipping the multi-GB `.osrm` files is
operational weight a two-week pilot should not carry. Compute Routes Essentials is $5 / 1000
with 10,000 free per month; with the in-city skip and the coordinate cache, projected pilot
volume sits inside the free tier.

**Rejected:** a regional OSRM extract (West Bengal + Sikkim — genuinely light, ~300 MB resident,
still the fallback if quote volume outgrows the free tier); Haversine in production (mis-prices
every trip, and the adapter refuses to construct there).

**Consequences:** a billing account and a second Google key — server-side, IP-locked to the API
host, restricted to the Routes API, and separate from the browser `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
The `X-Goog-FieldMask` is `routes.distanceMeters` alone and `routingPreference` is
`TRAFFIC_UNAWARE`: both keep the call in the Essentials SKU, and traffic-awareness would let a
jam move a fare band. Revisit when monthly billable calls approach the free cap — the cache hit
rate and the in-city share are the levers, then regional OSRM.

## 2026-09-01 — `STAGING_UNSAFE`: one opt-in flag opens the login guards, for staging only

**Decision:** a single env var, off unless set to exactly `true`, relaxes four production guards
together: `loadEnv()` accepts `DEV_FIXED_OTP`, `identity.container.ts` wires the fixed-OTP bypass,
`LoggingOtpSender` writes codes to the log instead of faulting, and `scripts/seed.ts` runs. The
API prints a warning block naming all four on every boot while it is set.

**This supersedes the second consequence of [2026-08-24](#2026-08-24--a-dev-only-fixed-otp-scoped-to-seeded-accounts)**,
which said a production process with `DEV_FIXED_OTP` set does not start. It still does not — unless
this flag is set alongside it. Everything else in that entry stands, including the scoping to
seeded numbers and the shared `completeSignIn`.

**Why:** a staging host is a production BUILD, and nobody could log into one. `LoggingOtpSender` is
the only `OtpSenderPort` that exists (no SMS provider is chosen yet) and it refuses to run in
production, so `otp/send` returned 500 and the login screen never reached its code field. The
rejected alternative was running staging as `NODE_ENV=development`, which buys the same thing while
also dropping `Secure` from the refresh cookie, putting stack traces and client IPs in error
bodies, serving `/docs` to the internet and re-enabling the mock payment gateway — four unrelated
production behaviours changed to fix one.

**Consequences:** `NODE_ENV` stays `production` on staging, so everything not named above behaves
as it does in production. The four guards read `isProduction && !allowDevShortcuts`, keeping both
halves visible at the point of use rather than hiding the exception inside `isProduction`.

The cost is real and accepted: the seeded phone numbers and the conventional code `000000` are both
committed, so a host with this flag set can be signed into as an administrator by anyone who has
read this repository. It belongs on a throwaway VM holding no real data. `apps/api/.env.prod.example`
says so, and the boot warning repeats it on every restart rather than once at deploy time — the
failure mode is a staging env file outliving staging.

**Also decided here:** `src/scripts/seed.ts` becomes a third esbuild entrypoint, so a deployed
stack can be seeded at all. The runtime image carries `dist/` and production `node_modules` with no
`tsx` and no TypeScript. It builds to `dist/scripts/seed.js` and runs as a profiled one-shot compose
service, so `up -d` never triggers it.

**Refs:** `apps/api/src/config/env.ts`, `apps/api/src/modules/identity/identity.container.ts`,
`apps/api/src/modules/identity/infrastructure/otpSender.log.ts`, `apps/api/src/scripts/seed.ts`,
`apps/api/test/stagingUnsafe.test.ts`, `docker-compose.prod.yml`

---

## 2026-08-28 — An incity variant is a duration and a price; a return fare is the whole two-way trip

**Decision:** two changes, both narrowing what a package can express.

- **The incity variant loses `includedKm`, `extraMinuteRatePaise`, `extraKmRatePaise`,
  `enforceDropInCity` and `sortOrder`.** What is left is `label`, `includedMinutes`,
  `baseFarePaise` and `driverCommissionBps`. `includedMinutes` stays because it is what the
  customer buys and what tells the driver when they are released.
- **`roundTripFarePaise` is the whole two-way journey**, not a same-day round trip. A 540 km
  destination matches the band containing 540 — the ONE-WAY distance — and that band's return
  fare covers all 1,080 km of driving, however many days the driver is away.

This closes three open questions, all by deletion rather than by specification:
[`LLD/open-questions.md`](LLD/open-questions.md) **Q1** (no destination rule), **Q2** (no overage
billing at all), and **Q4** (a round trip is however long it takes).

**It also removes the rung-(a) guard in `resolveForTrip`.** Incity used to win only within
`incity.max_distance_multiple` × the longest variant's `includedKm`; that field is gone and the
guard was dropped rather than re-expressed as a flat km limit. This reverses the 2026-08-20 entry
below that introduced the multiple, and the `incity.max_distance_multiple` settings key that entry
promised is no longer coming.

**What it costs, and none of it is hypothetical:**

- **A 3-hour booking that runs 3h 40m is free.** The most common real-world event in an hourly
  product now has no fare consequence — it is an operations conversation.
- **A long cross-city trip sells as an hourly rental.** Both points inside the city zone means
  incity at any distance, and with overage gone there is nothing to collect the difference. A
  60 km run at ₹900 is now a legal outcome.
- **A 2-day and a 5-day outstation trip to the same town pay the same**, because distance is the
  only thing that selects a band and there is no per-day allowance.

**Why anyway:** the fields were carrying a pricing model nobody was going to operate. An unused
overage rate is not free — it is a number in a form that has to be right, a field in a snapshot
that has to be frozen, and a dispute path that has to be defended. Removing them makes the
product smaller and the admin screen honest about what it actually charges. Each cost above is
recoverable by restoring the field it came from; none of them is recoverable by accident.

---

## 2026-08-28 — Price no longer varies by car category; an outstation band is a flat fare

**Decision:** A package's price is not keyed by car category. An outstation band carries
`oneWayFarePaise`, a nullable `roundTripFarePaise` and one `driverCommissionBps`; an incity
variant carries `baseFarePaise`, its two overage rates and one `driverCommissionBps`. The
`prices[]` subdocument is gone from both, along with `CommissionType` (`PERCENT | FLAT`) and the
separately stored company commission.

Three things follow, each deliberate:

- **The band fare is flat.** `extraKmRatePaise` and `driverAllowancePaise` were removed rather
  than defaulted to zero — a field that is always zero is a field someone eventually sets. This
  closes [`LLD/open-questions.md`](LLD/open-questions.md) Q3.
- **The company's commission is derived**, `10000 − driver`. Storing both let a form save 75%
  and 20% and leave 5% of every trip in nobody's column.
- **`roundTripFarePaise` is nullable**, meaning "this band does not sell a same-day return" —
  never "the return is free".

**Why:** the admin editor made the old model's cost concrete. A band asked for ten price rows
(five categories × two directions) and ops filled in one; the screen was a column of `not sold`.
That is flat pricing with more ways to get it wrong, plus a grid nobody could scan.

**What it costs, and it is real:** an SUV and a hatchback now pay the same fare for the same
trip. That is pricing power we have given up, not an inefficiency we have removed. Flat bands
also need to be narrower to stay fair, which is why splitting a band became a first-class admin
action and why an uncovered distance is a red row in the band list rather than a silence.

**Not affected:** car category still exists and still matters. It is recorded on the booking and
it decides which drivers may be offered it
([`LLD/dispatch-and-assignment.md`](LLD/dispatch-and-assignment.md)). The list moved to
`CAR_CATEGORIES` in `packages/contracts/src/identity.ts`; there is still no `carCategories`
collection. Reversing this decision means restoring a price table keyed by category — the wire
field is gone, the concept is not.

---

## 2026-08-28 — Global settings are a key-value collection with the defaults in code

**Decision:** `globalSettings` stores one document per **overridden** key and nothing else. Each
key's default, Zod schema, unit, label, description and read-audiences live in
`apps/api/src/modules/settings/domain/setting.registry.ts`. An absent row means "at its default".

**Why:** The alternative — a seeded row per key — makes every default a database value, so
changing one requires a migration and a fresh install requires a seed script that must be kept in
step with the code that reads it. Defaults in code are reviewed, typed and diffable, and a key
added tomorrow ships working on every environment at once. It also makes `SettingKey` a union of
literals, so a typo'd key is a compile error rather than an `undefined` quietly entering a fare.

**Consequences:** No seed, no migration, ever. A row hand-written in a Mongo shell for an unknown
key is ignored, and one whose value no longer parses falls back to the default with a warning
rather than throwing under a fare calculation. The registry is the file that must be edited to add
a setting — and the only one: the admin API, both audience APIs, the OpenAPI document and the
phase-2 form all derive from it.

**Rejected:** a typed document with one field per setting. Renaming or adding a field then needs a
migration, and the shape stops being something the UI can render generically.

---

## 2026-08-28 — Money in `globalSettings` is whole rupees, not paise

**Decision:** Settings money is an integer number of **rupees** in Mongo, on the wire and in the
UI. Keys carry no unit suffix (`pricing.insurance_charge`, not `..._paise`). Fractions are
rejected. This is the one exception to "money is an integer number of paise"
(`LLD/database-schema.md` §Conventions), which still holds everywhere else.

**Why:** These are ops-facing round figures typed into an admin form. A field that wants `10000`
to mean ₹100 is a data-entry error waiting to happen, and no settings amount has ever needed
sub-rupee precision — the places that genuinely do (tax and commission, both basis points) are
computed from paise fields and round once at the end, which is unaffected.

**Consequences:** Two units now coexist in the same expression, and `baseFarePaise +
settings['pricing.insurance_charge']` is a 100× undercharge that looks plausible on a receipt.
Contained by making `Rupees` an **opaque** type in `settings/domain/money.ts`: settings money
leaves `SettingsReadContract` as a `Rupees`, which cannot be added to a number at all, so
`rupeesToPaise()` is the only way across and omitting it fails `tsc`.

Worth recording that the obvious form of this — `type Rupees = number & { __unit: 'RUPEES' }`,
the standard branded-number recipe — **does not work** and was caught only by testing it: an
intersection is still assignable to `number`, so the arithmetic compiles and only assignment in
the harmless direction is caught. `settings.typecheck.ts` pins the distinction so nobody
"simplifies" it back.

---

## 2026-08-28 — Time-of-day surcharges are global, not per price row

**Decision:** Early-morning and late-night surcharges are two global windows plus two global
amounts in `globalSettings`. The dormant `nightChargePaise` field on incity price rows is
removed, along with `night_charge_paise` from `IncityPriceDto`.

**Why:** The same fare line configured in two places is one place too many, and per-row night
charges mean a surcharge change is an edit to every price row rather than one number. Nothing read
the field — the `pricing` module does not exist yet — so this is free now and expensive later.

**Consequences:** No data migration: the field is absent from every seeded package and Mongoose
simply stops projecting it. The two windows are held non-overlapping by a cross-key invariant, so
at most one surcharge can apply to a booking and the fare engine's branch is an if/else rather
than a precedence rule. Setting a charge to `0` disables it; the window stays meaningful.

---

## 2026-08-28 — Cancellation is a fee ladder with no hard cutoff

**Decision:** There is no time after which a customer is refused a cancellation. The cost rises
by lifecycle stage (`cancellation.customer_fee_en_route`, `..._arrived`), with a free window after
confirmation and a separate free window for scheduled bookings.

**Why:** A hard block does not prevent the cancellation, it converts it into a no-show — which
costs a driver's full waiting time *and* a support ticket, instead of a fee that at least
compensates someone. The deterrent is the price, not the door.

**Consequences:** Both ladders are validated to never step down, as a cross-key invariant: a
cheaper cancellation at the door than en route would reward waiting until the driver arrives. Every
fee a customer can incur is readable at `GET /api/customer/settings` before they commit, which is
the disclosure rule in `LLD/booking-lifecycle.md` made mechanical — the registry's per-key
`audiences` field decides it, not whoever writes the next endpoint.

---

## 2026-08-26 — The zone editor runs on Google Maps, not MapLibre

**Decision:** the admin zone editor uses the Google Maps JavaScript API — `google.maps.Data` for
saved zones, `DrawingManager` plus an editable `Polygon` for the draft, `PlaceAutocompleteElement`
for address search. MapLibre GL and Mapbox Draw are removed, with the worker copy script and CSS
shims they required. This reverses the MapLibre entry in
[`engineering/tech-choices.md`](engineering/tech-choices.md), which is rewritten to match.

**What it replaced, and why it changed:**

1. **The place-data gap was real in practice.** OSM's roads and place names in Siliguri are
   adequate; its commercial POI coverage is thin, and *orienting yourself* — not tracing — was
   the repeated complaint. Hybrid view (imagery **with** road labels) and Places search answer it
   directly.
2. **"Google is expensive" was right about the wrong screen.** It stands for the customer app and
   for the road-distance path, where quote traffic runs ~3× bookings. It never applied to a screen
   three ops people open a few times a month, which sits inside the free monthly allowance.
3. **MapLibre v6 resolves its web worker from `import.meta.url`**, which webpack rewrites to a
   hashed chunk path. The worker 404'd and surfaced as
   `Failed to load module script: … MIME type "text/html"` — a runtime-only failure the
   production build reported as success. Fixable, but only by a script working around the bundler.

**What it costs:** a billing-backed API key that ships in the client bundle and must be referrer-
and API-restricted ([`engineering/frontend-architecture.md`](engineering/frontend-architecture.md)
§Environment); clunkier editing of many-vertex polygons, mitigated by GeoJSON import being the
primary way a zone gets its shape; and one extra `Polyline` overlay, because `google.maps.Data`
cannot dash a stroke and the city boundary must stay visibly dashed.

**What made it cheap:** geometry crosses every boundary as GeoJSON and `validateZone` in
`@driverzone/geo` does not know what drew the polygon. The swap touched `ZoneMap.tsx`, two files
in `features/zones/lib/`, and ~30 lines of `ZonesScreen`; the rail, inspector, violation panel,
every hook and all validation were untouched. **Keeping the map a leaf is what made this
reversible, and it is worth preserving.**

---

## 2026-08-25 — Hard delete is back, as a separate route from soft deactivate

**Decision:** `DELETE /admin/zones/:id/hard` permanently removes a zone document. Blocked with
`409 ZONE_STILL_ACTIVE` unless the zone is already inactive — deactivate it first via the
existing `DELETE /admin/zones/:id`, which is unchanged and still blocks on nothing. This
reverses the "Pickup zones are a serviceability gate and a fee" entry below, which retired hard
delete entirely on the reasoning that `DELETE` should just mean soft-deactivate.

**Why:** product wants a real permanent-removal path, not only "make it stop resolving." With
Z-1 retired there is no longer a parent/child relationship between zones for a delete to check —
that was FR-Z6's original blocking mechanism — so the only gate `zones` can still enforce on its
own is "not currently active." `catalog`/`bookings` referencing this id is invisible to `zones`
(tier 3, below both) and stays that way; this is the same limitation `GetZoneDependentsUseCase`
already accepts for its own CITY warning.

**Why a separate route, not `DELETE /:id?hard=true`:** one HTTP verb performing two very
different operations — one reversible, one not — based on a query flag is easy to get wrong from
a client. A distinct path makes the irreversible action harder to trigger by accident.

**Consequences:** `ZoneRepositoryPort.deleteById` and `DeleteZoneUseCase` are back (a hard
delete existed before the 2026-08-25 redesign, in a different shape — blocked on parent/child
links that no longer exist, rather than on `isActive`). `ZONE_STILL_ACTIVE` added to
`FAULT_CODES`. `zones.md`'s HTTP surface and Codes tables updated to match.

**Refs:** [`LLD/zones.md`](LLD/zones.md) §HTTP surface, §Codes,
`apps/api/src/modules/zones/application/useCases/deleteZone.usecase.ts`

---

## 2026-08-25 — Brand primary is `#C0FF72`, and it is a surface, not an ink

**Decision:** the admin panel's primary colour is `#C0FF72`, replacing `#0b6bcb` in
`tokens.ts`. It is used only as a **fill with dark text on it** — primary buttons, the active nav
item, selected pills. A separate token, `interactive` (`#3F6212`), carries every coloured _ink_:
links, focus rings, selected state, the active tab underline.

**Why the split:** `#C0FF72` scores **1.18:1 against white**. As text, an icon, a border or a
focus ring it is invisible — not "low contrast", invisible. The logo's `#1EBC00` fails too, at
2.55:1. There is no way to have one token that is both the brand fill and a usable ink, so there
are two, and [`engineering/design-language.md`](engineering/design-language.md) says which is
which.

**What it costs:** every use of the accent has to ask "fill or ink?", which is one more decision
per component than a mid-tone brand colour would need.

**The guard is a test, not this document.** `theme.contrast.test.ts` asserts every declared
text-on-surface pair at 4.5:1 and every UI boundary at 3:1. A brand colour that looks like it
should be the text colour will be tried as the text colour eventually; the test is the answer
that does not depend on anyone having read the doc.

---

## 2026-08-25 — TanStack Query, and the design system gains runtime dependencies

**Decision:** `@driverzone/design-system` takes its first runtime dependencies —
`@radix-ui/react-*` for dialog, sheet, dropdown, select, tooltip, tabs and popover, plus `clsx`
and `tailwind-merge`. Styling is Tailwind v4, themed from `tokens.ts`. Server state is TanStack
Query v5.

**Why now, for TanStack Query:** [`engineering/tech-choices.md`](engineering/tech-choices.md)
listed a state-management library under _Deliberately absent_ with "add it when the admin panel
actually needs it, not before". The zone editor is that moment — debounced validation on every
geometry change, invalidation across a list and a detail view at once, and a map that must not
blank on a background refetch. That row is now struck.

**Why Radix, given the package had no dependencies at all:** focus trapping, escape and
outside-click handling, typeahead and ARIA wiring are the parts of a component library that are
genuinely hard, and a hand-rolled version is wrong in ways that only surface for a keyboard or
screen-reader user. Radix is unstyled, so the design language stays ours.

**Rejected:** shadcn/ui — a large head start, at the cost of roughly thirty vendored files we
then own and a second token layer to keep in sync with `tokens.ts`; CSS Modules with custom
properties — no dependency at all and the honest alternative, but noticeably slower for dense
tables and forms.

**The rule this sets:** the bar for the next runtime dependency in that package is the same one
Radix cleared — a component we would otherwise get subtly wrong. Not convenience.

**Unchanged and load-bearing:** `tokens.ts` still imports nothing, which is what lets
`@driverzone/mobile-ui` consume it without pulling a web dependency into a Metro bundle.

---

## 2026-08-25 — The admin panel talks to the API directly; there is no BFF

**Decision:** `apps/web` is a client-side application that Next serves. Every screen is a client
component, no Server Component fetches from the API, and Next runs no route handlers of its own.

**Why:** [`LLD/auth.md`](LLD/auth.md) gives an admin an access token in the response body and a
refresh token in an httpOnly cookie **scoped to `/api/admin/auth`**. The access token therefore
lives in the browser and a Server Component has no way to obtain one. Making RSC data fetching
work would mean Next owning a second session — a second store, a second set of expiry rules, a
second thing to get wrong — to server-render an internal tool used by a handful of ops staff.

**Rejected:** a BFF layer of Next route handlers with a Next-owned session cookie. It has a
genuinely better XSS posture, since the access token never reaches browser JavaScript. It loses
on the zone editor being irreducibly client-side anyway, and on keeping one auth design across
all four clients.

**What it costs, and this is real:** no server-side data fetching and no streaming for the
heavier admin screens, which was one of the reasons Next was chosen in the first place. What
remains — file-based routing, layouts, per-route code splitting, `output: 'standalone'` — is
still worth having.

**Two consequences worth knowing before they surprise someone:**

1. **The panel must be same-site with the API in production.** The refresh cookie is
   `SameSite=Strict` and set on the API's origin, so `admin.driverzone.in` beside
   `api.driverzone.in` works and a different registrable domain means the cookie is never sent
   and login silently never completes. Local development is unaffected — ports do not affect
   site. Recorded in [`engineering/build-and-deploy.md`](engineering/build-and-deploy.md).
2. **A hard reload always costs one refresh round-trip**, because the access token is held in
   memory and never in `localStorage` — storing it where an XSS could read it would give back
   most of what the httpOnly cookie buys. Session restore _is_ a silent refresh, so the shell
   renders a boot skeleton rather than a flash of the login screen.

---

## 2026-08-25 — Terrain is a property of the destination point, not the route

**Decision:** an outstation trip is `HILL` when its drop point falls inside a HILL zone, and `PLAIN`
otherwise. The route is never measured. This reverses assumption **A5**
([`LLD/open-questions.md`](LLD/open-questions.md)) and retires
`outstation.hill_route_threshold_m`.

**Why:** the classifier becomes a field read off a query that is already running — `resolveAt(to)`
returns every zone containing the point, so terrain costs nothing. The design it replaces measured
route metres inside a hill polygon against a threshold, and that was worse in four concrete ways:
the threshold was an admitted guess with "tune it when drivers complain" as the plan; a contested
fare could only be explained by walking a driver through a route-length sum, rather than pointing
at a map pin; it carried a tail of geometry edge cases (`lineSplit` throwing, a route wholly inside
a polygon with no boundary to split on, a route grazing two zones); and ops had no direct control,
because the polygon and the threshold interacted in ways that were hard to predict from the map.

**What it costs, and this is real:** a plains destination reached only by crossing a hill stretch
now prices as `PLAIN`, and the driver is underpaid for the hardest part of the job. That was the
original argument for route classification and it has not stopped being true.

**The mitigation is operational, not technical.** A hill zone's edge is now a price boundary, so
it must be drawn over the _approach corridor_ and not just the summit towns. If a destination is
reached through the hills, the road to it belongs inside the polygon. The admin editor says so
when the zone type is `HILL`.

**Consequences:** OSRM stays — the distance band still needs road distance, and haversine
under-reports 30–50% in hills, worst exactly when the destination is in the hills. But the route
_geometry_ was only ever fetched for terrain, so OSRM is now called with `overview=false` and the
H3 cache stores no polyline.

`classifyTerrain` and `hillMetresOnRoute` are **retained in `@driverzone/geo`, tested and unused**,
the same treatment `checkWithinParent` got when Z-1 was retired — reviving route-based
classification is a wiring change rather than a rewrite. `findHillZonesNear` on
`ZoneResolutionContract`, its use case and its repository method go dormant with them.

**Known limit, accepted:** this is a bet that Siliguri's geography rarely produces a flat
destination behind a mountain. If driver complaints show otherwise, the trigger to revive is
explicit and the code is still there.

**Refs:** [`LLD/packages.md`](LLD/packages.md) §Terrain,
[`LLD/zone-resolution.md`](LLD/zone-resolution.md) §Terrain, `packages/geo/src/terrain.ts`

---

## 2026-08-25 — The server picks the product; a quote returns exactly one package

**Decision:** resolution takes `from` + `to` and returns **one** package — incity with all its
variants, or outstation with the price row for the requested car category and direction. The
client no longer chooses incity vs outstation.

**Why:** the customer should not have to know which product their trip is. They know where they
are and where they are going; classifying that is the system's job, and it is the job the zone
layers already do. It also retires FR-B3's carry-the-points-across-tabs behaviour, which existed
only because the client was making a decision it lacked the data to make.

**The precedence ladder**, first rung that separates two candidates wins: incity over outstation;
`HILL` over `PLAIN`; lower computed total for this request; most recently created, then id.

**The guard that makes rung one safe:** a 60 km drop that happens to land inside the city polygon
matches both an incity package and an outstation band. Preferring incity blindly sells an hourly
rental for what is plainly an outstation run — the extra-km rate collects roughly the right money,
but it is the wrong product and nobody chose it. So incity wins only within
`incity.max_distance_multiple` × the longest variant's `included_km`, and falls through above that.

**A deliberate asymmetry, stated so it does not read as inconsistency:** the price rung resolves
ties _downward_ (never over-charge on a config error), while the terrain rung resolves _upward_
(`HILL` over `PLAIN`, which costs more). The first protects the customer from our mistake; the
second protects driver supply, because a driver underpaid on hill trips stops accepting them.
Under destination-point terrain the second rung is unreachable anyway — a point is either in a
hill zone or it is not — and it stays only as a defensive default.

**Consequences:** `PackageLookupContract` returns one match rather than a list. That is
deliberate: the ladder is the packages module's rule, and a caller that ranks candidates itself is
a caller that will eventually rank them differently.

**Refs:** [`LLD/packages.md`](LLD/packages.md) §Resolution,
[`LLD/zone-resolution.md`](LLD/zone-resolution.md)

---

## 2026-08-25 — Pickup zones are a serviceability gate and a fee; Z-1, P-1 and the package↔zone links are retired

**Decision:** a pickup zone answers one question — _may we pick up here, and does it cost extra_ —
identically for incity and outstation. It has no parent, and no package references it. `pickupZoneIds`
is deleted from both package schemas along with its indexes; invariant **P-1** goes with it, and
**Z-1** (pickup ⊆ city) is retired. The city zone now only defines what "incity" means: it scopes the
incity package and answers the `to` check. See [`LLD/zones.md`](LLD/zones.md).

**Why:** the two jobs were tangled. Free-vs-paid is a property of the _zone_ — `pickupChargeType`,
which `computeInCityFare` already reads — not a package dimension, and both Siliguri pickup zones sell
the same catalogue. Once that is true the M:N link buys nothing: it costs a join, two invariants, a
multi-select in the package editor, and a re-point step on every geometry version.

Z-1 fell out of the same reasoning. Its stated purpose was making a runtime config fault unreachable —
but the fault only existed _because_ of the parent link, a `parentZoneId` that could disagree with the
polygon it sat in. Removing the link deletes the fault rather than merely hiding it: a 500 that paged
someone became a 200 offering the customer outstation instead. What it buys is real: a pickup zone may
now sit outside the city, and Bagdogra airport and NJP station are the two highest-value outstation
pickups in Siliguri.

**Rejected: hard-coding the singletons** — dropping `cityZoneId`, treating "the city zone" as a
constant, one incity package wired in. It saves about a day and costs a data migration plus a rewrite
of zone resolution the first time a second city appears. The generic part that is expensive is the
_admin surface_; the generic part that is cheap is the _data_. Cut the first, keep the second: no city
switcher, no zone tree, no per-city package scoping in the UI — but the schema and `resolveAt` would
answer correctly for five cities unchanged.

**Consequences:** `@driverzone/geo` needed **no change at all** — `validateZone` already took
`parentGeom` as optional and ran `checkWithinParent` only when supplied. Z-1 is dormant rather than
deleted, so a future nested-zone design switches it back on instead of re-adding a field. All 31 tests
still pass. `STRADDLING_PICKUP` changes meaning: it was a Z-1 violation fixture and is now a legal zone
whose northern half drives the new `PICKUP_OUTSIDE_CITY` outcome.

**Known limit, accepted:** a pickup zone drawn somewhere absurd is no longer caught at save time. Z-2
still prevents the _dangerous_ case — two overlapping pickup zones making resolution non-deterministic
— and a pickup zone in the wrong district is merely useless rather than wrong. The nightly integrity
job and the `dependents` view make it visible.

**Refs:** [`LLD/zones.md`](LLD/zones.md), [`LLD/domain-model.md`](LLD/domain-model.md),
[`LLD/zone-resolution.md`](LLD/zone-resolution.md), `packages/geo/src/zone-rules.ts`

---

## 2026-08-25 — MongoDB `2dsphere` for containment, Turf for predicates; no PostGIS

**Decision:** containment lookups are MongoDB's job (`$geoIntersects` over a `2dsphere` index);
geometric predicates and derived geometry are Turf's, in `@driverzone/geo`. No second datastore, no
geo microservice, no hosted tilequery API.

**Why write down what we were already doing:** because there is a trap in it that fails _silently_.
GeoJSON RFC 7946 wants exterior rings counter-clockwise. Turf is indifferent to winding; the
`2dsphere` index is not — it reads ring orientation to decide which side is "inside", and a clockwise
exterior ring on a large polygon is interpreted as _the whole earth except that shape_. Nothing
throws. The symptom is a hill zone that contains every route in India, so every outstation trip prices
as `HILL`. Map editors and imported GeoJSON produce clockwise rings routinely. The mitigation is one
line — `@turf/rewind` in the write path — and it is only obvious once someone has named the failure.

Same family: a single-ring polygon larger than a hemisphere is read as its own complement, hence
`Z-MAX-AREA` beside the existing `Z-MIN-AREA`.

**Rejected: PostGIS.** Two datastores and a dual write for a few hundred polygons, and it costs the
single-transaction booking→ledger write that already requires the Mongo replica set. The triggers it
buys are already replaced by the choke-point-plus-nightly-job design.

**Rejected: a geo service or hosted tilequery.** A network hop and a per-call price on the hottest path
in the product, for data we should own. Quote requests run roughly 3× booking volume.

**Consequences:** the split is load-bearing in both directions. MongoDB cannot express a
cross-document geometric constraint (so Z-2/Z-3 live in application code), has no `$geoIntersection`
and no length aggregation (so terrain classification narrows in the database and measures in process),
and cannot return derived geometry (so the editor's red "offending area" is computed by Turf). None of
those are worked around — each is why the other half of the split exists.

**Refs:** [`LLD/zones.md`](LLD/zones.md) §Why MongoDB geo, `packages/geo/`

---

## 2026-08-24 — Zone geometry crosses the wire as raw GeoJSON, not `{lat,lng}`

**Decision:** every zone-geometry field in the API — `CreateZoneRequest.geometry`,
`ValidateZoneRequest.geometry`, `ZoneDto.geometry`, and so on — is a GeoJSON `Polygon`
(`[lng, lat]` per ring point). This is the one deliberate exception to this API's `{lat,lng}`
convention for every other coordinate (`api-contracts.md`).

**Why:** a polygon drawn in the admin map editor (Mapbox Draw / MapLibre) is already GeoJSON on
the client. `@driverzone/geo`'s `{lat,lng}` ↔ GeoJSON helpers (`toPosition`/`fromPosition`) exist
for a single point; round-tripping an entire ring through `{lat,lng}` objects just to convert it
straight back on arrival adds a translation layer with nothing to gain, on the one payload shape
that's already speaking the right protocol.

**Consequences:** `zones/interface/zones.validation.ts` validates GeoJSON structurally, and its
`Position` schema is `number[]` — not a fixed 2-tuple — matching `@types/geojson` exactly.
Narrowing it to `[number, number]` looked reasonable and broke the compile-time drift guard in
`zones.typecheck.ts`, since GeoJSON's own `Position` deliberately allows an optional third
(elevation) element.

**Refs:** `apps/api/src/modules/zones/interface/zones.validation.ts`,
`packages/contracts/src/zones.ts`

---

## 2026-08-24 — Zone deactivation is reversible-with-confirmation; delete is FR-Z6's hard block

**Decision:** `POST /admin/zones/:id/deactivate` implements `admin-panel.md`'s blast-radius UX —
blocked when the zone has active dependents unless `force: true` is passed, after which it
proceeds. `DELETE /admin/zones/:id` implements FR-Z6's literal "blocked" behaviour with no
override: allowed only once the zone is already inactive and nothing still references it.

**Why:** `prd.md` FR-Z6 says a zone with dependents is "blocked" on delete/deactivate;
`admin-panel.md`'s actual UX shows the blast radius and offers "[Deactivate anyway]" — two
different behaviours under one requirement. Resolved by mapping FR-Z6's hard block onto the
truly destructive action and `admin-panel.md`'s softer UX onto the reversible one: a deactivated
zone's version history and audit trail are never lost (Z-5), so "confirm and proceed" is a safe
default there in a way it is not for an actual delete.

**Also decided here:** dependents are zone-native only for now — a CITY's active PICKUP
children. `catalog`/`bookings` don't exist yet, so the "3 packages reference this zone" / "8
bookings in the queue" parts of `admin-panel.md`'s example dependents screen can't be computed
inside `zones` (it sits below both in the tier graph and may not depend on either). The response
shape is designed so those sections are additive later, not a breaking change.

**Refs:** `apps/api/src/modules/zones/application/useCases/deactivateZone.usecase.ts`,
`deleteZone.usecase.ts`, `getZoneDependents.usecase.ts`

---

## 2026-08-24 — Hill-zone resolution drops the `settings` dependency

**Decision:** `ZoneResolutionContract.findHillZonesNear(route)` returns intersecting HILL
zones only — geometry, not a PLAIN/HILL verdict. This reverses `adding-a-module.md`'s worked
example for `zones`, which said the module "consumes `settings` (for the hill threshold)".

**Why:** the threshold-based classification (`classifyTerrain()` in `@driverzone/geo`, which
needs the threshold) is business logic belonging to whichever module actually needs the
verdict — `quotes`, not built yet. Making `zones` depend on a `settings` module that doesn't
exist yet, just to run one function call it doesn't otherwise need, was the wrong shape for the
dependency; geometry is `zones`'s job, the threshold is `quotes`'s.

**Consequences:** `zones` has one fewer tier dependency than the worked example sketched.
`quotes`, once built, calls `classifyTerrain()` itself with the zones this method returns and
its own `settings`-sourced threshold.

**Refs:** `apps/api/src/modules/zones/application/useCases/findHillZonesForRoute.usecase.ts`,
`docs/engineering/adding-a-module.md`, `docs/LLD/zone-resolution.md`

---

## 2026-08-24 — The generic `auditLog` model moved to `shared/`

**Decision:** `identity/infrastructure/auditLog.model.ts` moved to
`apps/api/src/shared/db/auditLog.model.ts`. `identity/infrastructure/audit.mongo.ts` and the new
`zones/infrastructure/audit.zones.ts` are both thin adapters over the one shared model.

**Why:** the schema was already entity-agnostic (`entityType` is the discriminator) and `zones`
needed the identical thing. `module-internals-are-private` forbids `zones` importing
`identity/infrastructure/`, and duplicating the schema in a second file would let the two drift.
`shared/` is importable by every module (`shared-is-below-modules`), so a schema more than one
module genuinely needs belongs there rather than inside whichever module happened to need it
first.

**Consequences:** no behaviour change for `identity` — its existing audit tests pass unchanged
against the moved model. Each module still declares its own `AuditPort`/`AuditEntry` in its own
`domain/` (a port is something each bounded context owns for itself, even when the adapter
behind it is shared) — only the Mongoose schema moved.

**Refs:** `apps/api/src/shared/db/auditLog.model.ts`,
`apps/api/src/modules/identity/infrastructure/audit.mongo.ts`,
`apps/api/src/modules/zones/infrastructure/audit.zones.ts`

---

---

## 2026-08-24 — A dev-only fixed OTP, scoped to seeded accounts

**Decision:** `DEV_FIXED_OTP` — unset by default — makes `otp/verify` accept one fixed code, but
only for the four accounts `pnpm seed` creates, and only outside production.

**Why:** logging in locally meant calling `otp/send` and reading the code off a log line, on every
attempt, for every role. That friction is paid dozens of times a day. The alternative designs were
worse: accepting a fixed code for _any_ number in development would mean the real generation,
hashing and attempt-burning paths are never exercised until staging, so a bug in them surfaces
somewhere expensive.

**Consequences:** four independent conditions must hold — the variable set, `NODE_ENV` not
production, the number on the seed allowlist, and the code matching. Wiring lives in exactly one
expression in `identity.container.ts`, so "can this happen in production" is answerable by reading
one line rather than auditing a branch inside application logic. `loadEnv()` is the second lock:
a production process with the variable set **does not start**, rather than ignoring it — an
ignored bypass variable in a prod env file is a landmine for whoever later "fixes" the code that
ignores it.

The bypass skips the challenge, not the account rules. It routes into the same `completeSignIn`
as a real code, so an unprovisioned admin number still fails — a shortcut with its own
token-issuing path is how a dev convenience quietly acquires different rules from the thing it
shortcuts.

**Also decided here:** `src/scripts/*` is exempted from the `no-restricted-imports` module
boundary. The seed has to create an admin, and `identity` exposes no way to do that _on purpose_ —
`account.repository.impl.ts` throws for `create('ADMIN', …)`. There is no contract route to take,
so an exemption is more honest than widening a public contract to accommodate a dev fixture.

**Known limit, accepted:** anyone who reads the repository knows the seeded numbers and, if the
variable is set, the code. That is fine for a local database and catastrophic against a shared
one — which is what the production guards are for. If a shared staging environment ever appears,
this needs revisiting: `NODE_ENV !== 'production'` would no longer be a sufficient test.

**Refs:** `apps/api/src/scripts/seed.ts`, `apps/api/src/config/devAccounts.ts`,
[`setup-development.md`](setup-development.md)

---

## 2026-08-24 — Numeric prefixes dropped from every doc; `check-doc-links.sh` now checks prose

**Decision:** Every file in `docs/`, `docs/LLD/` and `docs/engineering/` loses its `NN-` prefix.
The old `13-auth-and-user` doc is additionally split into [`LLD/auth.md`](LLD/auth.md) and
[`LLD/user.md`](LLD/user.md). This reverses the "numbers were **not** rebased" decision of
2026-08-22 below.

**Why:** `LLD/` ran `02`–`13` with no `01`, an artefact of the flat layout it was moved out of.
The sequence conveyed nothing and every new module widened the gap. The original rationale —
that keeping numbers preserved "see docs/04" references in code — held only while nobody minded
the numbering; there were 12 such references and naming the doc is clearer than citing an
ordinal anyway. Doing all three directories at once, rather than `LLD/` alone, avoids a state
where a bare `04-*.md` mention is ambiguous between two directories.

The `auth`/`user` split is separate: that doc had grown to ~500 lines covering two subjects —
getting a token, and everything you do once you have one.

**Consequences:** 219 references rewritten across ~80 files, plus 24 `git mv`s and 23 H1
headings. Both README index tables lose their `#` column; row order already carried the reading
order. Four references that were **already broken** before this change (`docs/roadmap` in the
three app entry points, and `docs/dispatch-and-assignment` in the coding-standards doc — both
missing the `LLD/` segment) are repaired,
along with ten stale link labels whose visible text disagreed with their target.

**Also decided here:** `scripts/check-doc-links.sh` gains a second pass over **prose**, not just
markdown links. Of the 207 references this rename touched, only 52 were links — the checker was
blind to 75% of them, which is exactly how 8 references broke silently during the previous move
while this script was already running in `pnpm check`. The new pass reads every `*.md` mention in
`.md`/`.ts`/`.tsx`/`.cjs`/`.mjs`/`.yml` and fails on any that names a file which does not exist.
Verified by deliberately breaking a reference inside a `.ts` comment and confirming a non-zero
exit.

**Known limit, accepted:** the prose pass matches on basename, so it catches renames and typos
but not a reference pointing at a real doc that says something else. It also warns rather than
fails on duplicate basenames across directories — that ambiguity is what this rename removed,
and it should stay visible if it returns.

**Refs:** `scripts/check-doc-links.sh`, [`README.md`](README.md)

---

## 2026-08-24 — Identity admin actions are audited, and APPROVE/REJECT are their own verbs

**Decision:** Every admin mutation in the `identity` module — driver approve, driver reject,
per-document review — writes an `auditLog` row. `auditLog.action` gains `APPROVE` and `REJECT`
alongside the existing `CREATE`/`UPDATE`/`DELETE`/`ACTIVATE`.

**Why:** `LLD/architecture.md` requires every admin action to be audited, and these are the
first admin endpoints that mutate anything — retrofitting an audit trail onto actions already
shipped is how gaps get missed. The new verbs exist because none of the original four describe
approving a person: folding an approval into `UPDATE` makes "who approved this driver, and
when" answerable only by decoding the `after` blob and comparing it against the previous row,
which is exactly the question the collection exists to answer directly.

**Consequences:** the audit write is deliberately **non-fatal** — `MongoAuditLog` catches, logs
at `error`, and returns. An audit outage must not roll back an approval the admin already
watched succeed, and the main write has usually already committed by then anyway.

**Known limit, accepted:** a dropped audit entry is therefore invisible to the actor. That is
the right trade for an availability-critical path, and it is why the failure logs loudly enough
to alert on. Unlike `bookingEvents`, this collection is not yet append-only at the database
role; it should be when that role is next revised — an audit log the application can rewrite
answers no question worth asking.

**Refs:** `apps/api/src/modules/identity/infrastructure/audit.mongo.ts`,
[`LLD/database-schema.md`](LLD/database-schema.md)

---

## 2026-08-24 — Driver documents ship behind a storage port with a dev stub

**Decision:** `DocumentStoragePort` is defined in `identity/domain/`, and `StubDocumentStorage`
implements it for development — minting a plausible storage key and a URL that accepts nothing.
No object storage is wired up.

**Why:** `LLD/architecture.md` specifies an S3-compatible private bucket with 5-minute
presigned URLs, and nothing in the repo or either compose file provides one. The alternative was
dropping the document requirement from `POST /driver/onboarding/submit`, which would have
shipped a verification gate weaker than the one specified and left no code path to strengthen
later. Behind a port, the entire flow — upload request, document row, submission gate, admin
review — is exercisable today and the real adapter is one line in `identity.container.ts`.

**Consequences:** the stub **refuses to run in production**, the same posture as
`LoggingOtpSender`. A deploy that silently accepted document uploads into nowhere would look
like it worked and surface weeks later as an admin opening a licence and finding nothing. The
port stays inside the module for now; it moves to `shared/storage/` when `bookings` needs
receipt URLs, which `architecture.md` already anticipates.

**Also decided here:** the document row is written _before_ the file is uploaded, holding the
key the client is about to `PUT` to. A failed upload then leaves a `PENDING` document the driver
can retry rather than no record at all. The cost — a row referencing an object that never
arrived — resolves itself: an admin reviewing an empty document rejects it.

**Refs:** `apps/api/src/modules/identity/infrastructure/documentStorage.stub.ts`,
[`LLD/auth.md`](LLD/auth.md), [`LLD/user.md`](LLD/user.md)

---

## 2026-08-24 — Driver requires admin approval before duty; customer profile stays fully progressive

**Decision:** Customer profile fields are never required beyond `mobile_number` — they fill in
progressively through normal app usage, including a new booking-time save
(`save_pickup_address`/`save_vehicle` on `POST /bookings`). Driver is the opposite: a full
profile plus a `LICENCE` and an `AADHAAR` document must be submitted
(`POST /driver/onboarding/submit`) and explicitly approved by an admin
(`POST /admin/drivers/:id/approve`) before `POST /driver/duty` will succeed.

**Why:** the two roles share the exact same OTP login mechanism, so without this entry the
asymmetry reads like an inconsistency rather than a decision. Customer: low trust required, the
product wants friction-free signup, a missing field just means a slightly worse trip experience.
Driver: an unverified person shows up at someone's pickup location and drives their car — the
admin-approval gate is a safety/liability control, not bureaucracy.

**Consequences:** `driverSchema` gains an `onboardingStatus` state machine
(`INCOMPLETE → SUBMITTED → APPROVED/REJECTED`) alongside the existing `isVerified` boolean,
which stays the one field the dispatch-eligibility index and the duty gate actually read — one
admin action sets both together rather than two independently-driftable flags. `identity`
gains a write-side contract, `CustomerBookingProfileContract`, for `bookings` (tier 6) to call
into `identity` (tier 1) — tier-legal with no dependency-cruiser exception needed.

**Refs:** [`LLD/user.md`](LLD/user.md#driver),
[`LLD/database-schema.md`](LLD/database-schema.md#drivers),
[`LLD/api-contracts.md`](LLD/api-contracts.md)

---

## 2026-08-24 — Admin auth unified to phone + OTP, reversing email+password+TOTP

**Decision:** All three roles — customer, driver, admin — authenticate with phone + OTP.
`architecture.md`'s "email + password + TOTP for admins" is reversed; nothing in the system
stores a password.

**Why:** Admin was originally password+TOTP because it's the highest-privilege role and SMS OTP
is interceptable via SIM-swap fraud or SS7 signaling — TOTP has no telecom dependency, which is
a real security argument for password+TOTP. Reversed anyway: admin is a small,
individually-provisioned population, not self-service, and carrying a separate
password-hashing-plus-TOTP-enrollment stack for one role — when the other two already need a
full OTP pipeline — was judged not worth the duplication at this stage. One consistent auth flow
won on simplicity.

**Consequences:** no password field, no TOTP secret, no recovery codes anywhere in `identity`.
Admin reuses the same `otp/send`/`otp/verify`/`refresh`/`logout` use cases as customer/driver,
parameterized by role.

**Known limit, accepted:** losing TOTP means losing the one factor immune to SIM-swap/SS7
interception, on the role with the largest blast radius if compromised — zone geometry, pricing,
booking reassignment, full PII access (`architecture.md` §Security). Mitigated by two cheap
knobs, not a second factor: (1) `otp/verify` never auto-provisions an admin account — the number
must already exist in `admins`, inserted out-of-band by another admin; (2) admin's refresh token
TTL is 12h vs. 30d for customer/driver, shrinking how long a stolen session stays valid. If
admin-account compromise becomes a real incident, this is the first reversal to reconsider.

**Refs:** [`LLD/architecture.md`](LLD/architecture.md#security),
[`LLD/auth.md`](LLD/auth.md), [`LLD/user.md`](LLD/user.md)

---

## 2026-08-24 — JWT via `jose`, HS256, separate access/refresh secrets

**Decision:** Access and refresh tokens are both JWTs, signed with `jose` rather than
`jsonwebtoken`, algorithm pinned to `HS256` on verify, signed with two different secrets
(`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`).

**Why:** `jose` is ESM-native — this repo is `"type": "module"` throughout — and its verify API
takes an explicit algorithm allowlist rather than trusting the token's own `alg` header, which is
what closes algorithm-confusion attacks outright rather than by convention. HS256 over RS256
because this is a modular monolith (`LLD/open-questions.md` A11): one process signs, the same
process verifies, so there is no second service that needs to verify without holding the signing
secret. Two secrets, not one, so a leaked access-token secret cannot forge a refresh token and
vice versa — the two have very different blast radii, 15 minutes against up to 30 days.

**Consequences:** two new required env vars. Access-token verification is entirely stateless, no
DB round-trip — the standard trade-off for a short TTL: a revoked user stays valid on
already-issued access tokens for up to 15 minutes, accepted rather than solved with a
per-request revocation check.

**Refs:** [`LLD/auth.md`](LLD/auth.md#token-lifecycle)

---

## 2026-08-24 — Refresh tokens rotate; reuse revokes the whole session family

**Decision:** Every refresh call issues a new refresh token and invalidates the old one.
Presenting an already-used refresh token — the signature of a stolen token racing the
legitimate one — revokes every session in that token's family, not just the one being refreshed.

**Why:** Adapted from a pattern in an earlier project (`waagent`'s `refreshSession.usecase.ts`)
that proved out well there. A stolen refresh token is only useful to an attacker until it is
used once; rotation converts "the token leaked" into "the token leaked and was used before the
legitimate client's next refresh" — a much narrower window — and reuse detection turns that race
into a hard signal instead of a silent compromise. A small grace window (~5s) tolerates a
genuine double-submit from a flaky mobile network without false-flagging it as theft.

**Consequences:** every refresh needs a session-record lookup (`tokenHash`, `usedAt`,
`familyId`) in Mongo, not just a stateless JWT verify — a small latency cost accepted for a
security property a stateless design cannot provide. A reuse event logs at `error` with
`isExpected: false`, which per `shared/http/error-handler.ts` is what pages someone.

**Refs:** [`LLD/auth.md`](LLD/auth.md#token-lifecycle)

---

## 2026-08-24 — Refresh token delivery splits by role, not by a client-type flag

**Decision:** Admin's refresh token is set as an httpOnly, Secure, SameSite=Strict cookie scoped
to `/api/admin/auth`. Customer and driver both get the refresh token in the JSON response body.
No generic "client type" parameter exists anywhere in the auth flow.

**Why:** The three roles already imply the channel — admin is the web-only ops panel; customer
and driver are mobile-only apps that cannot rely on an httpOnly cookie the way a browser can.
Building a channel-negotiation flag for a distinction that never actually varies (an admin token
request never comes from a mobile app, and vice versa) would be an abstraction for something the
routing layer (`/admin/auth/*` vs `/customer/auth/*` vs `/driver/auth/*`) already expresses.

**Consequences:** the mobile apps own their own secure storage of the refresh token (Keychain /
EncryptedSharedPreferences) — an app-side concern, not an API one. If a web-based customer or
driver product ever ships, this decision needs revisiting; it is not designed to generalize past
the current three clients.

**Refs:** [`LLD/auth.md`](LLD/auth.md#token-lifecycle)

---

## 2026-08-24 — Login OTPs are stored as a keyed HMAC, not password-grade hashed

**Decision:** OTP challenges in Redis store `HMAC-SHA256(code, server_pepper)`, not a
bcrypt/Argon2 hash.

**Why:** A 6-digit code carries roughly 20 bits of entropy and a 5-minute TTL — a slow,
memory-hard hash defends against offline brute-force of a secret that is already
effectively unbrute-forceable within its lifetime by the attempt limit and cooldown alone (see
`LLD/auth.md`). What a memory-hard hash _would_ cost here is verify-time latency
under legitimate retry, for no matching security gain. A keyed HMAC is fast, non-invertible
without the server-held pepper, and is the right tool for a short-lived, low-entropy,
rate-limited secret — distinct from the admin-auth-unification entry above, which removes the
need for any password hash at all.

**Consequences:** `OTP_PEPPER` becomes a required env var, distinct from the JWT secrets — a
leaked pepper only devalues in-flight OTP challenges (5-minute blast radius), not a long-lived
credential.

**Refs:** [`LLD/auth.md`](LLD/auth.md#otp)

---

## 2026-08-22 — winston replaced with pino

**Decision:** pino for application logging, reversing the winston choice in
[`engineering/tech-choices.md`](engineering/tech-choices.md).

**Why:** redaction, not speed. This system logs around trip-start OTPs, phone numbers and
bearer tokens — an OTP in a log is a driver starting a trip they never arrived for. pino has
`redact` built in; winston has nothing, so every rule would have been a format we wrote and
maintained. The original rejection ("faster, and the speed is irrelevant at our volume") was
also measured against the wrong number: [`LLD/architecture.md`](LLD/architecture.md)
specifies 200 location writes/s sustained.

Done now because 15 call sites is a morning and the thirteen modules ahead would make it a
week — the same reasoning as the container-shape change above.

**Consequences:** the argument order is reversed (`logger.info({ data }, 'msg')`), and getting
it wrong is silent — pino logs the object as the message and drops the fields. All 15 sites
migrated. `LOG_LEVEL` gains `fatal` and `trace`.

**Known limit, accepted:** path-based redaction cannot see PII interpolated into a message
string. Closed with an ESLint rule enforcing static messages rather than left to discipline.

**Refs:** `apps/api/src/shared/logging/logger.ts`,
[`engineering/coding-standards.md`](engineering/coding-standards.md#logging)

---

## 2026-08-22 — Two paths are excluded from the access log

**Decision:** `/api/health` (while succeeding) and the driver location ping are never
access-logged.

**Why:** the reasoning behind _not_ logging something is the kind that gets lost and then
"fixed" by someone adding it back. Health is polled every 15 s by the container healthcheck —
~5,700 lines a day carrying no information. The location ping runs at 200 writes/s sustained,
which is ~17M lines a day and would be the single largest item on any log bill, while telling
you nothing a metric would not tell you better.

**Consequences:** a failing health check still logs, because that is the case you need. If
location pings ever need investigating, the answer is a counter, not a log line.

**Also decided here:** the access log records the route _pattern_ (`/api/bookings/:id`), never
the raw URL — raw paths carry identifiers, blow up cardinality, and put IDs into a retained,
indexed field.

**Refs:** `apps/api/src/shared/http/access-log.middleware.ts`

---

## 2026-08-22 — Module containers expose `buildRouter()`, not a `router`

**Decision:** A module container returns `{ contract, buildRouter: () => Router }`.
`buildContainers()` moved out of `routes.ts` into `src/container.ts`, which both entrypoints
import; `routes.ts` now only mounts what it is handed.

**Why:** Both the HTTP server and the worker need every module's contract, but only one serves
HTTP. With an eager `router` property the worker allocated an Express router, its middleware and
its validation schemas for every module, in a process with no listener. One wasted router today
and thirteen once the modules land — and the shape is copied thirteen times, so it is cheap now
and tedious later.

**Consequences:** `docs/engineering/adding-a-module.md` step 9 is now "build it in
`container.ts`, mount it in `routes.ts`". The ESLint boundary exemption moved from `routes.ts`
to `container.ts`; `routes.ts` is deliberately left unexempted, so the rule keeps watching the
file most likely to grow a shortcut.

**Refs:** [`engineering/module-anatomy.md`](engineering/module-anatomy.md)

---

## 2026-08-22 — The health probe issues a real command

**Decision:** `mongoHealth()` pings the server (`admin().ping()`, 2 s timeout) instead of
reading `mongoose.connection.readyState`.

**Why:** `readyState` is a client-side socket flag. It stays `1` when the server is wedged or
the replica set has lost its primary — the "not primary" failure this project already documents
— so `/api/health` reported `healthy` while every write failed. That endpoint gates the
container healthcheck and the load balancer's rotation, so the false positive keeps a dead
instance in service. Confirmed by pausing the Mongo container: previously `healthy`, now `503`
with `detail: "ping timed out"`.

**Consequences:** `readyState` is kept as a fast negative — free, and definitive when it says
no. The 2 s timeout is deliberately tighter than the orchestrator's 15 s interval; a check that
can outlast its poller is worse than none.

**Refs:** `apps/api/src/shared/db/mongo.ts`

---

## 2026-08-22 — LLD docs moved to `docs/LLD/`

**Decision:** The eleven low-level design docs (`02`–`12`) moved into `docs/LLD/`. The PRD,
`README.md` and `setup-development.md` stay at `docs/` root.

**Why:** `docs/` had grown to fourteen files at one level, mixing "what we're building" with
"how the dispatch state machine works". `engineering/` was already a subdirectory; this makes
the split symmetric — product intent at the root, low-level design in `LLD/`, code structure in
`engineering/`.

**Consequences:** 44 markdown links and 8 prose references in code broke, because the move was
a pure `git mv`. Repaired immediately after, and `scripts/check-doc-links.sh` now runs as part
of `pnpm check` so the next move fails loudly instead of silently. Numbers were **not**
rebased — `LLD/` starts at `02` — so every "see docs/04" reference in code stays meaningful and
git history stays followable.

**Refs:** `d274855`

---

## 2026-08-22 — Mobile dev servers bypass Turborepo

**Decision:** `pnpm dev:customer` and `pnpm dev:driver` call `pnpm --filter … dev` directly
rather than going through `turbo run dev`.

**Why:** turbo's output multiplexer is not a TTY, and Expo checks. Run through it and you lose
the QR code, the keyboard shortcuts (`a`, `i`, `r`, `j`) and the `exp://` URL — leaving a Metro
bundler with no way to reach it. A second Expo makes it worse: it prompts `Use port 8082
instead? (Y/n)` and under turbo nothing can answer, so the task hangs forever. Verified both
ways; `--ui=tui` does not help.

**Consequences:** Mobile work costs a second terminal. Bare `pnpm dev` is now a trap — it
starts both Expo servers this way — and is documented as one rather than silently redefined.

**Refs:** `0c00c69`, [`setup-development.md`](setup-development.md)

---

## 2026-08-22 — `docker-compose.yml` split into dev and prod

**Decision:** Two files, `docker-compose.dev.yml` (Mongo, Redis, OSRM) and
`docker-compose.prod.yml` (those plus API, worker, web from built images). The bare
`docker-compose.yml` was deleted, so every command names its target with `-f`.

**Why:** One file mixing infrastructure with production application builds meant
`docker compose up` did two different things depending on which services you named. Developers
want the databases in Docker and the apps on the host, where a save reloads in under a second
instead of rebuilding an image.

**Consequences:** No bare `docker compose up` — deliberate, since the ambiguity was the
problem. The two stacks use separately named volumes (`-dev` / `-prod`) so a production-mode
experiment cannot write into the database you develop against. Production publishes no Mongo or
Redis ports at all; inspect via `exec`.

**Rejected:** merging the two with `-f dev.yml -f prod.yml`. The infrastructure genuinely
differs — published ports and volume names — so the merge would have needed overrides for most
of what it shared.

**Refs:** `df93f98`, [`setup-development.md`](setup-development.md)

---

## 2026-08-22 — Production env kept separate from development env

**Decision:** `docker-compose.prod.yml` reads `apps/api/.env.prod`, with
`apps/api/.env.prod.example` committed as the template. The dev `apps/api/.env` is untouched.

**Why:** The dev file carries `NODE_ENV=development`, `LOG_LEVEL=debug` and localhost URIs.
Loading it into a production image silently misconfigures all three, and the failure looks like
an application bug rather than a wiring one.

**Consequences:** One more file to create on first run, and `docker compose -f
docker-compose.prod.yml` fails with a clear message until you do. `.gitignore` needed
`!**/.env.*.example` — the existing `.env.*` rule was swallowing the new template.

**Refs:** `df93f98`

---

## 2026-08-22 — Dev database ports bind loopback and are overridable

**Decision:** `docker-compose.dev.yml` publishes `127.0.0.1:${MONGO_PORT:-27017}:27017` and the
same shape for Redis and OSRM, rather than binding `0.0.0.0`.

**Why:** An unauthenticated Mongo reachable from whatever network the laptop is on is not worth
the convenience. The variable exists because a host-installed Mongo or Redis on the default
port is common — it came up on the first machine this ran on.

**Consequences:** Changing the port means changing `apps/api/.env` to match; the override moves
the host side only. A root `.env` makes it stick without retyping.

**Refs:** `df93f98`

---

## 2026-08-22 — `MONGO_URI` carries the replica-set parameters

**Decision:** `apps/api/.env.example` ships
`mongodb://localhost:27017/driverzone?replicaSet=rs0&directConnection=true`, not the bare URI.

**Why:** Without them the driver connects in single-node topology. Ordinary reads and writes
work fine, so nothing looks wrong — and then the first multi-document transaction, the
booking→ledger write in [`LLD/pricing-and-commission.md`](LLD/pricing-and-commission.md),
fails with `Transaction numbers are only allowed on a replica set member or mongos`, months
away from the setup that caused it.

**Consequences:** None at runtime. The single-node replica set was already required; this just
makes the client agree.

**Refs:** `df93f98`
