# Decision Log

Decisions that have been **made**, newest first, with what they replaced and what they cost.

Three files cover decisions and they do not overlap:

| File | Answers |
|---|---|
| [`LLD/open-questions.md`](LLD/open-questions.md) | What is **not yet decided** — assumptions A1–A12 and the open items that block build |
| [`engineering/tech-choices.md`](engineering/tech-choices.md) | **Current state**: what we use and why, written in the present tense |
| this file | **History**: when it changed, what it replaced, what was rejected |

When an open question closes: add an entry here, rewrite `tech-choices.md` (or the relevant
LLD doc) to describe the new present, and strike the item from `open-questions.md`. This log
is append-only — entries are never edited to match a later reversal. A reversal is a new entry
that references the old one.

Keep entries short. If the reasoning needs more than a paragraph it belongs in a doc, and the
entry links to it.

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
it must be drawn over the *approach corridor* and not just the summit towns. If a destination is
reached through the hills, the road to it belongs inside the polygon. The admin editor says so
when the zone type is `HILL`.

**Consequences:** OSRM stays — the distance band still needs road distance, and haversine
under-reports 30–50% in hills, worst exactly when the destination is in the hills. But the route
*geometry* was only ever fetched for terrain, so OSRM is now called with `overview=false` and the
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
ties *downward* (never over-charge on a config error), while the terrain rung resolves *upward*
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

**Decision:** a pickup zone answers one question — *may we pick up here, and does it cost extra* —
identically for incity and outstation. It has no parent, and no package references it. `pickupZoneIds`
is deleted from both package schemas along with its indexes; invariant **P-1** goes with it, and
**Z-1** (pickup ⊆ city) is retired. The city zone now only defines what "incity" means: it scopes the
incity package and answers the `to` check. See [`LLD/zones.md`](LLD/zones.md).

**Why:** the two jobs were tangled. Free-vs-paid is a property of the *zone* — `pickupChargeType`,
which `computeInCityFare` already reads — not a package dimension, and both Siliguri pickup zones sell
the same catalogue. Once that is true the M:N link buys nothing: it costs a join, two invariants, a
multi-select in the package editor, and a re-point step on every geometry version.

Z-1 fell out of the same reasoning. Its stated purpose was making a runtime config fault unreachable —
but the fault only existed *because* of the parent link, a `parentZoneId` that could disagree with the
polygon it sat in. Removing the link deletes the fault rather than merely hiding it: a 500 that paged
someone became a 200 offering the customer outstation instead. What it buys is real: a pickup zone may
now sit outside the city, and Bagdogra airport and NJP station are the two highest-value outstation
pickups in Siliguri.

**Rejected: hard-coding the singletons** — dropping `cityZoneId`, treating "the city zone" as a
constant, one incity package wired in. It saves about a day and costs a data migration plus a rewrite
of zone resolution the first time a second city appears. The generic part that is expensive is the
*admin surface*; the generic part that is cheap is the *data*. Cut the first, keep the second: no city
switcher, no zone tree, no per-city package scoping in the UI — but the schema and `resolveAt` would
answer correctly for five cities unchanged.

**Consequences:** `@driverzone/geo` needed **no change at all** — `validateZone` already took
`parentGeom` as optional and ran `checkWithinParent` only when supplied. Z-1 is dormant rather than
deleted, so a future nested-zone design switches it back on instead of re-adding a field. All 31 tests
still pass. `STRADDLING_PICKUP` changes meaning: it was a Z-1 violation fixture and is now a legal zone
whose northern half drives the new `PICKUP_OUTSIDE_CITY` outcome.

**Known limit, accepted:** a pickup zone drawn somewhere absurd is no longer caught at save time. Z-2
still prevents the *dangerous* case — two overlapping pickup zones making resolution non-deterministic
— and a pickup zone in the wrong district is merely useless rather than wrong. The nightly integrity
job and the `dependents` view make it visible.

**Refs:** [`LLD/zones.md`](LLD/zones.md), [`LLD/domain-model.md`](LLD/domain-model.md),
[`LLD/zone-resolution.md`](LLD/zone-resolution.md), `packages/geo/src/zone-rules.ts`

---

## 2026-08-25 — MongoDB `2dsphere` for containment, Turf for predicates; no PostGIS

**Decision:** containment lookups are MongoDB's job (`$geoIntersects` over a `2dsphere` index);
geometric predicates and derived geometry are Turf's, in `@driverzone/geo`. No second datastore, no
geo microservice, no hosted tilequery API.

**Why write down what we were already doing:** because there is a trap in it that fails *silently*.
GeoJSON RFC 7946 wants exterior rings counter-clockwise. Turf is indifferent to winding; the
`2dsphere` index is not — it reads ring orientation to decide which side is "inside", and a clockwise
exterior ring on a large polygon is interpreted as *the whole earth except that shape*. Nothing
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

## 2026-08-24 — A dev-only fixed OTP, scoped to seeded accounts

**Decision:** `DEV_FIXED_OTP` — unset by default — makes `otp/verify` accept one fixed code, but
only for the four accounts `pnpm seed` creates, and only outside production.

**Why:** logging in locally meant calling `otp/send` and reading the code off a log line, on every
attempt, for every role. That friction is paid dozens of times a day. The alternative designs were
worse: accepting a fixed code for *any* number in development would mean the real generation,
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
boundary. The seed has to create an admin, and `identity` exposes no way to do that *on purpose* —
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

**Also decided here:** the document row is written *before* the file is uploaded, holding the
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
`LLD/auth.md`). What a memory-hard hash *would* cost here is verify-time latency
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

**Why:** the reasoning behind *not* logging something is the kind that gets lost and then
"fixed" by someone adding it back. Health is polled every 15 s by the container healthcheck —
~5,700 lines a day carrying no information. The location ping runs at 200 writes/s sustained,
which is ~17M lines a day and would be the single largest item on any log bill, while telling
you nothing a metric would not tell you better.

**Consequences:** a failing health check still logs, because that is the case you need. If
location pings ever need investigating, the answer is a counter, not a log line.

**Also decided here:** the access log records the route *pattern* (`/api/bookings/:id`), never
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
