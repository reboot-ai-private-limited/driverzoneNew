# Auth

`https://api.driverzone.in/v1` — same base as [`api-contracts.md`](api-contracts.md).

How a caller proves who they are. What they can then *do* — profiles, addresses, vehicles,
driver onboarding, admin verification — is [`user.md`](user.md).

- JSON only, `snake_case` keys, same wire conventions as [`api-contracts.md`](api-contracts.md).
- All three roles — `customer`, `driver`, `admin` — authenticate with **phone + OTP**. See the
  decision log, 2026-08-24, for why admin no longer uses email + password + TOTP.
- `Authorization: Bearer <jwt>` on every authenticated request. The JWT's `aud` claim is the
  role; a customer token on a driver route is `403 FORBIDDEN`, a missing/malformed token is
  `401 UNAUTHENTICATED`.
- **This doc is API surface only** — endpoints, payloads, error/success codes. Frontend/UI flow
  (screens, client state machines, onboarding copy) is a later addition.
## Errors

New codes this module introduces:

```jsonc
{
  "success": false,
  "statusCode": 429,
  "code": "OTP_ATTEMPTS_EXCEEDED",
  "request": { "method": "POST", "url": "/v1/auth/otp/verify", "requestId": "req_01J…" },
  "message": "Too many incorrect attempts. Request a new code.",
  "data": { "retry_after_seconds": 0 }
}
```

The envelope is `HttpErrorBody` from `packages/contracts/src/http.ts` — see
`api-contracts.md` §The envelope. Bodies below are shown without it, for brevity.

| Code | Status | Meaning |
|---|---|---|
| `OTP_INVALID_OR_EXPIRED` | 401 | Wrong code, expired challenge, or — for admin — a number that was never provisioned. Deliberately indistinguishable from the outside; see §Admin. |
| `OTP_ATTEMPTS_EXCEEDED` | 429 | 5 wrong guesses against one challenge burns it. `otp/send` again; there is no "one more try". |
| `OTP_COOLDOWN_ACTIVE` | 429 | A resend was requested inside the 60s cooldown. `details.retry_after_seconds` says how long. |
| `OTP_SEND_LIMIT_EXCEEDED` | 429 | 5 sends/hour/phone or 10 sends/hour/IP, whichever hits first. |
| `SESSION_REVOKED` | 401 | The refresh token's session family was revoked — almost always because an already-used refresh token was replayed. Sign in again. |
| `REFRESH_TOKEN_INVALID` | 401 | Malformed, expired, or a signature that doesn't verify. |

`UNAUTHENTICATED`, `FORBIDDEN` and `RATE_LIMITED` (already in `FAULT_CODES`, `api-contracts.md`)
cover the generic cases — a missing bearer token, a right-token-wrong-audience request, and
throttling that isn't OTP-specific (e.g. `POST /quotes` 30/min/user). They are reused here, not
duplicated.

---

## OTP

One mechanism, three mount points — `/customer/auth/otp/*`, `/driver/auth/otp/*`,
`/admin/auth/otp/*` are the same use case parameterized by role, not three implementations.

A 6-digit numeric code (`crypto.randomInt`, not `Math.random`), delivered by SMS, valid **5
minutes**. This is a different code from the 4-digit trip-start OTP in
`booking-lifecycle.md` — that one is read aloud to a driver in person; this one is a
SMS-delivered login credential. No reason to share a length.

### `POST /{role}/auth/otp/send`

```jsonc
{ "mobile_number": "+919876543210" }
```

**200**

```jsonc
{ "sent": true, "expires_in_seconds": 300, "retry_after_seconds": 60 }
```

**429**

```jsonc
{ "code": "OTP_COOLDOWN_ACTIVE", "message": "Please wait before requesting another code.",
  "data": { "retry_after_seconds": 41 } }
```

Rate-limited to 5 sends/hour/phone (the existing spec, `architecture.md`) and 10 sends/hour/IP
(new — blunts enumeration from a single source hammering many numbers). The response shape is
**identical** whether or not `mobile_number` is already registered — nothing here reveals
account existence, matching the same anti-enumeration posture as `otp/verify` below.

### `POST /{role}/auth/otp/verify`

```jsonc
{ "mobile_number": "+919876543210", "otp": "482913" }
```

**200 — customer / driver**

```jsonc
{
  "is_new_user": false,
  "access_token": "eyJ…",
  "refresh_token": "eyJ…",
  "user": { "id": "…", "full_name": "…", "mobile_number": "+919876543210" }
}
```

`is_new_user: true` on the first-ever verify for that number — the account is created right
here, with only `mobile_number` set. The client walks onboarding (name, DOB, …) afterward via
`PATCH /{role}/profile`. There is no separate registration endpoint for customer or driver.

**200 — admin**

```jsonc
{ "access_token": "eyJ…", "user": { "id": "…", "full_name": "…" } }
```

No `refresh_token` in the body (it's set as a cookie — see §Token lifecycle) and no
`is_new_user` — admin accounts are never created by this endpoint. See §Admin.

**401**

```jsonc
{ "code": "OTP_INVALID_OR_EXPIRED", "message": "That code is incorrect or has expired." }
```

Five wrong attempts burns the challenge (`OTP_ATTEMPTS_EXCEEDED`) — the client's next move is
`otp/send` again, not another guess.

---

## Token lifecycle

- **Access token** — JWT, `HS256`, 15-minute TTL, claims `{ sub, role, aud, iat, exp }`.
  Verified statelessly, no DB round-trip. `aud` equals `role`, which is the audience check: a
  token issued for one role is rejected outright on another role's routes.
- **Refresh token** — also a JWT (self-describing expiry), signed with a **separate** secret
  from the access token, carrying `sid` (session id). Backed by a `sessions` record
  (`database-schema.md`) for rotation and revocation.
- **Rotation** — every `refresh` call issues a new refresh token and marks the presented one
  used. **Reusing an already-used refresh token revokes its entire session family** — the
  signature of a stolen token racing the legitimate client, not a routine retry. A ~5s grace
  window tolerates a genuine double-submit from a flaky mobile connection without flagging it
  as theft.
- **TTLs** — access: 15 minutes, all roles. Refresh: **30 days** for customer/driver (mobile
  apps expect to stay logged in), **12 hours** for admin (shorter web session, higher-privilege
  role — the one safeguard kept after dropping TOTP; see decision log, 2026-08-24).
- **Delivery** — admin's refresh token is an httpOnly, Secure, `SameSite=Strict` cookie scoped
  to `/api/admin/auth`; its access token is in the body. Customer and driver get **both**
  tokens in the body — mobile apps can't rely on an httpOnly cookie, and the client stores the
  refresh token in Keychain / EncryptedSharedPreferences.
- **Clients must refresh proactively** — at roughly 80% of the access token's 15-minute
  lifetime, not reactively on a `401`. This matters most for the driver app: it runs a
  foreground service while on duty (`architecture.md`), and a token lapsing mid-shift on a
  weak signal is a working driver logged out, not just a retry.

### `POST /{role}/auth/refresh`

Customer/driver body: `{ "refresh_token": "eyJ…" }`. Admin: **no body** — the cookie is read
server-side.

**200**

```jsonc
{ "access_token": "eyJ…", "refresh_token": "eyJ…" }
```

Admin's response omits `refresh_token` — it's rotated into the cookie instead, never into JSON.

**401 — reused or revoked**

```jsonc
{ "code": "SESSION_REVOKED", "message": "Please sign in again." }
```

### `POST /{role}/auth/logout`

Customer/driver body: `{ "refresh_token": "eyJ…" }`. Admin: no body — clears the cookie. Revokes
the session. Always `200 { "logged_out": true }`, even if the token was already invalid —
logout is idempotent by design, since a client retrying a logout after a flaky response must
never see an error for something that already happened.

---

---

## Admin provisioning

**No admin registration endpoint exists anywhere in this API.** An `AdminUser` document is
inserted by direct ops action, outside the HTTP surface entirely — matching "admin actions all
audited" ([`architecture.md`](architecture.md)), since the one action that *creates* admin access
is deliberately not something exposed to be automated or scripted against from outside.

`otp/send` looks up `mobile_number` against `AdminUser` first — but an unprovisioned number
still gets the ordinary **`200 { "sent": true }`**, identical to a real one. No SMS is
dispatched and no challenge is stored, so the subsequent `otp/verify` fails with the ordinary
`OTP_INVALID_OR_EXPIRED` because there is nothing to verify against.

> **Corrected 2026-08-24.** An earlier version of this section had `otp/send` return
> `OTP_INVALID_OR_EXPIRED` for an unprovisioned number and called that anti-enumeration. It is
> the opposite: a 401 for unknown numbers and a 200 for known ones makes this endpoint a
> directory of who works here — walk a number range and keep whatever doesn't error. The
> enumeration defence has to live in the *send* response being invariant, which is what is
> implemented.

A provisioned-but-never-logged-in admin can request and verify an OTP completely normally; what
is disabled is the auth flow ever *creating* the document.

---

## Assumptions carried into this design

- **Phone number recycling** — Indian telcos reassign a number after roughly 90 days idle — is
  an accepted, industry-standard risk across all three roles. No mitigation beyond what's
  already here (OTP + rate limits, and the provisioning gate for admin specifically).
