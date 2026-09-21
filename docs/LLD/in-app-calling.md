# In-App Calling

Driver and customer need to talk at exactly one moment that decides whether a trip happens:
**the pickup.** "I'm at the second gate", "I can't find you", "give me two minutes". This
document designs that conversation as an **in-app WebRTC voice call carried over our own
signalling** — no phone numbers, no telephony vendor, no per-minute bill.

The privacy guarantee is stronger than the one it replaces. Masking hides a real number behind
a virtual one; this design means **neither side's number exists anywhere in the call path at
all**, and the media is end-to-end encrypted with keys our server never holds.

Depends on **Phase 6** (driver app) and **Phase 7** (customer app) of
[`roadmap.md`](roadmap.md). Not yet a numbered phase — it slots in as **Phase 7.5**, before the
Phase 9 pilot. Each `## S-n` section is meant to be reviewed and signed off on its own.

## Scope

| | |
|---|---|
| Media | **Audio only.** No video, now or planned. |
| Topology | **1:1 peer-to-peer.** No SFU, no MCU, no media server — see [S-2](#s-2--architecture). |
| Signalling | Socket.IO over our own API, the same gateway offers and tracking use ([`architecture.md`](architecture.md) §Realtime). |
| Relay | Self-hosted `coturn` on the app VM, used only when P2P fails. |
| Platforms | Driver **Android only** (`prd.md` §6 — no iOS driver app). Customer **iOS + Android** (`prd.md` §2). |
| In scope v1 | Calls **in both directions**, canned messages, ConnectionService ringing, TURN fallback, call records, admin call metrics. |
| Out of scope v1 | Calls **received** on iOS (see [S-3](#s-3--phasing)), call recording, free-text chat, group calls, video, voicemail. |
| Explicitly rejected | PSTN number masking as the primary path — see [S-1](#s-1--why-webrtc-and-not-a-telephony-provider). Retained as a documented fallback. |

### Where the rules actually live

This doc is the calling design. It does not restate the systems it sits on:

| For | Read |
|---|---|
| Token lifecycle, what a socket handshake verifies | [`auth.md`](auth.md) |
| Booking states, when a trip is live | [`booking-lifecycle.md`](booking-lifecycle.md) |
| Endpoint and socket event payload shapes | [`api-contracts.md`](api-contracts.md) §Realtime |
| Module layout, ports, `*.public.ts` boundaries | [`../engineering/module-anatomy.md`](../engineering/module-anatomy.md) |
| Push delivery semantics, why the port is named for intent | `modules/notifications/domain/pushSender.port.ts` |
| Android ringing, foreground service, OEM battery traps | [`driver-app.md`](driver-app.md) |

---

## S-1 — Why WebRTC and not a telephony provider

[`architecture.md`](architecture.md) §Security and [`api-contracts.md`](api-contracts.md)
originally specified **masked numbers through a telephony provider** (Exotel/Knowlarity class),
with a `masked_phone` field on the booking payload. This doc reverses that. The reversal is
recorded in [`../decision-log.md`](../decision-log.md).

**What masking costs at our volume.** At an expected 10–20 calls/day (~600–1,200 min/month),
the per-minute charge is noise — roughly ₹1,200–2,000. What you actually pay is the **virtual
number rental and the provider's monthly plan floor**, a fixed ₹2,000–3,000 whether you place
ten calls or ten thousand, plus KYC/DLT paperwork before the first call connects.

**What WebRTC costs.** Licensing: nothing. WebRTC (BSD), Opus (royalty-free — unlike H.264/AAC
there is no patent pool), `react-native-webrtc` (MIT), `coturn` (BSD), APNs and FCM (free,
unquota'd). Infrastructure: a relayed call is ~80 kbps of egress, ~35 MB per call-hour. At our
volume that is **under ₹20/month** on the existing VM. There is no monthly floor and no
per-minute meter to watch as we grow.

**The honest trade.** WebRTC costs roughly three weeks of engineering and permanent maintenance
against OEM battery managers and iOS releases. Masking costs three to five days. **At 10–20
calls/day masking is the cheaper decision on pure economics** and that was the standing
recommendation. We are building this anyway, for reasons that are not this month's invoice:

- No vendor dependency, no KYC gate, no plan renegotiation.
- The cost curve is flat. At the `architecture.md` §Scale year-1 target (5,000 bookings/day)
  masking would run **~₹4.5 lakh/month**; this design stays under ₹1,000. The crossover is
  around 20,000–30,000 min/month (~300–500 calls/day) — we do not want to be re-architecting
  telephony at the exact moment we are scaling.
- Media is E2E encrypted (DTLS-SRTP). Our server relays packets it cannot decrypt. A masking
  provider, by construction, can hear and record every call.
- Opus wideband is audibly better than narrowband GSM voice.

**When to reverse again.** If the connect rate measured in
[S-9](#s-9--data-model-and-observability) sits below ~92%, add PSTN masking as a *fallback*
behind `InitiateCallUseCase` — see [S-10](#s-10--failure-modes-and-the-fallback-hook). That hook
is the reason this decision is cheap to walk back.

---

## S-2 — Architecture

A 1:1 voice call needs **no media server**. This is the single fact that makes self-hosting
viable, and it is worth stating plainly because the instinct is to reach for an SFU. An SFU
exists to fan one publisher out to many subscribers. We have exactly two parties, so the audio
goes device-to-device and our infrastructure never touches it.

```
  Customer app                    Our API (e2-medium)                 Driver app
  ────────────                    ───────────────────                 ──────────
       │                                   │                               │
       │──── socket: call:initiate ───────▶│                               │
       │                                   │── FCM high-priority data ────▶│  phone rings
       │◀─── ack { callId, iceServers } ───│                               │  (ConnectionService)
       │                                   │◀──── socket: call:answer ─────│
       │◀───── SDP / ICE relayed ─────────▶│◀───── SDP / ICE relayed ─────▶│
       │                                   │                               │
       │══════════ audio: SRTP over UDP, peer-to-peer, E2E encrypted ═════▶│
       │                                   │                               │
       │══════ or, when NAT blocks P2P: relayed via coturn on the VM ═════▶│
```

Three transports, three jobs:

| Layer | Carries | Why it cannot be one of the others |
|---|---|---|
| **Socket.IO (TCP)** | Signalling: invite, SDP, ICE, hangup | A few KB, only during the ~2s of setup. Reliability matters, latency does not. |
| **WebRTC (UDP/SRTP)** | The audio | TCP's head-of-line blocking makes real-time audio ratchet in latency and never recover on a weak mobile link. Audio must be allowed to *drop* packets. |
| **coturn (UDP relay)** | Audio, when P2P fails | Fixes connectivity (CGNAT/symmetric NAT). Fixes nothing about a thin or lossy pipe. |

Expect **~20–35%** of calls to need the relay. Indian carrier-grade NAT is aggressive.

**Do not stream audio over the Socket.IO connection.** It is the obvious shortcut and it is a
trap: WebSocket is TCP (see above), every call would traverse our VM instead of ~30% of them,
Node's event loop would be forwarding ~10k messages/sec at peak, we would be hand-building an
echo canceller and jitter buffer, and our server would hold plaintext audio in memory —
*weakening* the privacy this feature exists to provide.

---

## S-3 — Phasing

The split is driven by one constraint: **the initiator's app is already in the foreground.**
Only the *receiver* needs a privileged wake-up path — and on Android that path is a single
implementation, pointed either way.

### Why both directions ship together

`prd.md` §1: the customer owns the car and the driver comes to it. The driver is not collecting
a person from a kerb — they are locating **a specific parked vehicle and its owner**, in an
apartment basement, a society with four gates, the third level of an office car park. "Which
gate? Which floor? What colour is the car?" is a *driver-initiated* call, and in this product it
is plausibly more frequent than the customer-initiated one. Shipping calling without it would
miss the moment the feature exists for.

The expensive half of the second direction was never "driver initiates" — it is **iOS**. A
driver→Android-customer call reuses the driver's own receiver (FCM high-priority data →
CallKeep) wholesale, pointed the other way. Days, not weeks. It belongs in v1.

### Phase 1 — both directions, Android receivers, canned messages

| Path | Receiver wake-up |
|---|---|
| Customer → Driver | FCM → ConnectionService. The driver app is Android-only (`prd.md` §2). |
| Driver → **Android** customer | The same FCM → ConnectionService receiver, built once, used in both apps. |
| **iOS** customer → Driver | Works from day one — the initiator is in the foreground, so no push path is needed. |
| Driver → **iOS** customer | **Not available.** Falls back to canned messages. |

So an iOS customer can **place** a call in v1; they cannot **receive** one until Phase 2.

**Canned messages are v1, not a contingency.** Two taps — "I'm at the gate", "2 minutes away" —
over the same socket. They need no push-wake, they work on a weak link where a call will not
connect, and, the reason they are load-bearing here, they reach iOS over **ordinary APNs with no
PushKit**. They are the driver→iOS-customer path until Phase 2 lands, and the cheapest
reliability work in the whole feature ([S-10](#s-10--failure-modes-and-the-fallback-hook)).

### Phase 2 — iOS customers receive calls

- PushKit + CallKit. `apps/customer/app.config.ts` already wires the `aps-environment`
  entitlement; this adds `UIBackgroundModes: ['voip', 'audio']` and
  `NSMicrophoneUsageDescription`.

**`firebase-admin` cannot send VoIP pushes.** FCM has no PushKit path — a VoIP push must go to
APNs directly on topic `<bundleId>.voip`. So `fcm.pushSender.ts` gains a sibling
`apns.pushSender.ts`. The port absorbs this cleanly; that is what `pushSender.port.ts` was
written for. But it is a second delivery path to build, monitor and alert on.

**Apple's rule is unforgiving:** a VoIP push must be reported to CallKit essentially
immediately inside `didReceiveIncomingPush`. Miss it and iOS terminates the app; miss it
repeatedly and Apple revokes the VoIP entitlement. Enforced since iOS 13.

Sequence it after Phase 1 is in production, and size it against the **share of customers on
iOS** — a small minority in this market — rather than against feature symmetry. Until it lands,
every iOS customer still gets outbound calls plus inbound canned messages, which is a workable
product rather than a hole.

---

## S-4 — The Socket.IO gateway (shared)

[`architecture.md`](architecture.md) §Realtime already specifies Socket.IO + the Redis adapter
for offers, tracking and the ops dashboard. It is not installed yet. Calling rides that same
gateway, so this is shared cost — build it here, and dispatch inherits it.

```
src/shared/realtime/
  io.ts              server creation, Redis adapter, shutdown hook
  socketAuth.ts      handshake JWT verification
  rooms.ts           room naming — user:<role>:<id>, call:<callId>
```

- `io.ts` attaches to the `http.Server` that `createApp().listen(...)` returns in `server.ts`.
  The Redis adapter needs **two** connections (pub and sub); duplicate the client from
  `shared/queue/redis.ts` rather than sharing it — a subscribed connection cannot issue
  ordinary commands.
- `socketAuth.ts` is an `io.use()` middleware reusing `shared/security/jwt.ts`. It verifies
  `handshake.auth.token` and attaches `{ role, id }` to `socket.data`. **A client-supplied
  identity is never trusted** — the id comes from the token or the connection is refused.
- On connect, join `user:<role>:<id>`. That one room is what makes targeted delivery possible,
  for calls and for everything Realtime will carry later.
- `io.close()` joins the `shutdown()` sequence in `server.ts`, before `server.close()`, so a
  deploy does not sever a live call mid-sentence without a `call:ended`.

**Sticky sessions.** With more than one API instance behind a load balancer, Socket.IO needs
sticky routing or `transports: ['websocket']` only. Moot on today's single VM — recorded here
so it is not discovered in production.

---

## S-5 — The `calls` module

Conventional layout per [`../engineering/module-anatomy.md`](../engineering/module-anatomy.md):

```
src/modules/calls/
  domain/
    call.entity.ts              Call, CallStatus, EndReason
    call.errors.ts
    callRepository.port.ts
    turnCredentials.port.ts     mint() -> { urls, username, credential, ttl }
  application/
    callWindow.ts               is this booking callable, by this person, right now?
    useCases/
      initiateCall.usecase.ts
      answerCall.usecase.ts
      endCall.usecase.ts
      expireCall.usecase.ts     BullMQ job — the no-answer timeout
  infrastructure/
    call.model.ts
    callRepository.impl.ts
    coturn.turnCredentials.ts   HMAC-SHA1 ephemeral credentials
  interface/
    calls.controller.ts         REST — call history, admin metrics
    calls.gateway.ts            Socket.IO event handlers
  calls.container.ts
  calls.public.ts               getCallsForBooking() and nothing more
```

**`callWindow.ts` is the security boundary of this entire feature.** A call is permitted only
when all of the following hold:

1. The booking exists.
2. The requester is the customer on it, or the driver currently assigned to it.
3. Its status is `ASSIGNED | DRIVER_EN_ROUTE | ARRIVED | STARTED`, or `COMPLETED` within a
   short grace window (proposed: 2h — see [Open questions](#open-questions)).

Without rule 3 a completed booking becomes a permanent free line to a stranger. Without rules 1
and 2 any authenticated user can dial any other user. This file gets the densest test coverage
in the module. It also enforces invariant C-1 — see
[S-15](#s-15--concurrency-more-than-one-call-at-once).

`expireCall.usecase.ts` runs as a BullMQ job scheduled at +45s on initiate and cancelled on
answer. It is not a nicety: it is what resolves the single most likely failure — **the driver's
phone never rang** ([S-10](#s-10--failure-modes-and-the-fallback-hook)).

---

## S-6 — Signalling event contract

Types live in `packages/contracts/src/calls.ts`, shared by both apps and the API, exactly as
`bookings.ts` and `dispatch.ts` are today. Full payloads belong in
[`api-contracts.md`](api-contracts.md) §Realtime; this is the shape.

**Client → server**

| Event | Payload | Notes |
|---|---|---|
| `call:initiate` | `{ bookingId }` | Server authorises, creates the `Call`, acks `{ callId, iceServers }` |
| `call:answer` | `{ callId }` | |
| `call:decline` | `{ callId }` | |
| `call:sdp` | `{ callId, sdp }` | Offer and answer both |
| `call:ice` | `{ callId, candidate }` | |
| `call:hangup` | `{ callId, reason }` | |
| `msg:canned` | `{ bookingId, code }` | A canned message. `code` is an enum, never free text — see below |

**Server → client**

| Event | Payload |
|---|---|
| `call:incoming` | `{ callId, bookingId, peerName, iceServers }` |
| `call:ringing` / `call:answered` / `call:declined` | `{ callId }` |
| `call:sdp` / `call:ice` | relayed unchanged |
| `call:ended` | `{ callId, reason, durationS }` |
| `msg:canned` | `{ bookingId, code, from, sentAt }` |

**Canned messages carry a code, not a string.** The sender picks from a fixed enum in
`packages/contracts/src/calls.ts`; the receiver renders it in **their own** language. A free-text
field would be a channel for phone numbers, abuse and PII — everything this feature exists to
prevent — and it would need moderation we are not building. The same `callWindow.ts` check that
authorises a call authorises a message, and delivery is the existing push port (ordinary
notification priority, **not** the VoIP/ConnectionService path — which is precisely why it
reaches an iOS customer without PushKit).

**The relay rule.** The server **never** forwards to a client-supplied target. It loads the
`Call` by `callId`, confirms the sender is one of its two parties, and emits to the *other*
party's room. Anything else turns our signalling channel into a way to ring arbitrary users.

**`peerName` is a first name only.** No phone number, no surname, no email — nothing that
survives the trip. The whole point of the feature is that the identifier does not exist.

---

## S-7 — TURN

`coturn` on the app VM. Packet forwarding in C; ~50 MB RSS and negligible CPU at our volume.

```conf
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=<TURN_SHARED_SECRET>
realm=turn.driverzone.in
min-port=49160
max-port=49200
no-multicast-peers
no-tcp-relay
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
```

**The `denied-peer-ip` block is not optional.** Without it the TURN server will relay into our
own VPC and to the GCP metadata endpoint on `169.254.169.254` — an open proxy behind the
firewall, pointed at our own credentials.

GCP firewall: UDP/TCP 3478 and 5349, UDP 49160–49200. Forty relay ports is ample at our volume;
keep the range narrow so the rule stays tight.

**Ephemeral credentials** (`coturn.turnCredentials.ts`), validated natively by
`use-auth-secret`:

```
username   = <unixExpiry>:<callId>
credential = base64(HMAC-SHA1(TURN_SHARED_SECRET, username))
ttl        = 600
```

Minted per call, returned on `call:initiate` and `call:incoming`. **A static TURN credential
must never ship in an app bundle** — it is extracted within days and the relay becomes
somebody's free proxy, billed to our egress.

New `config/env.ts` entries, zod-validated in the existing style: `TURN_URLS`,
`TURN_SHARED_SECRET` (min 32 chars), `TURN_REALM`.

---

## S-8 — Mobile

```
react-native-webrtc
@config-plugins/react-native-webrtc     Expo config plugin
react-native-callkeep                   ConnectionService / CallKit
socket.io-client
```

Both apps run `expo prebuild` with committed `android/` folders
([`../engineering/mobile-in-monorepo.md`](../engineering/mobile-in-monorepo.md)), so config
plugins are the right mechanism. Add the WebRTC plugin to the `plugins` array and re-prebuild.

**Shared engine** in `packages/` — one implementation, both apps:

- `useCallSocket()` — connection lifecycle, token refresh, reconnect/backoff
- `useWebRTCCall()` — `RTCPeerConnection`, offer/answer, ICE, `getUserMedia({ audio: true })`
- Audio only. No video track is ever requested, so the camera permission is never triggered.

**Driver app (Android).** FCM high-priority *data* message → CallKeep `displayIncomingCall()` →
native incoming-call UI. Register via `ConnectionService` rather than a full-screen-intent
notification: it behaves correctly when the driver is already on a GSM call, and Android 14+
restricts full-screen intents for apps that are not registered calling apps. The duty
foreground service already described in [`driver-app.md`](driver-app.md) materially improves
push-wake reliability; the OEM battery-optimisation onboarding that doc specifies is a hard
prerequisite for this feature, not a nice-to-have.

Permissions added by the plugin: `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `BLUETOOTH_CONNECT`.

**Customer app.** Needs the in-app call screen (reached from the live-trip view) **and**, on
Android, the same receiver the driver app uses — FCM data message → CallKeep
`displayIncomingCall()`. Build the receiver once in the shared package and mount it in both
apps; that reuse is the whole reason driver-initiated calls fit in v1
([S-3](#s-3--phasing)).

On **iOS** the customer app is initiate-only in v1: no CallKeep, no PushKit, no VoIP
entitlement. Inbound reaches them as a canned message over ordinary APNs until Phase 2.

**Canned messages** are a small component in the shared package — a fixed enum rendered as two
or three tap targets on the live-trip screen, sent over the socket, delivered by the existing
push port at normal priority. No native work on either platform.

### Extending the notifications port

Do not build a second push path. Add to `pushSender.port.ts` and `notifications.public.ts`, in
the intent-not-mechanism style that file already argues for:

```ts
/** Rings someone for an in-app voice call. Android: high-priority FCM data → ConnectionService. */
sendCallInvite(to: Recipient, invite: CallInvitePush): Promise<DeliveryChannel>;
sendCallCancelled(to: Recipient, callId: string, reason: string): Promise<void>;
```

Implemented in `fcm.pushSender.ts` and `mock.pushSender.ts`; `apns.pushSender.ts` joins them in
Phase 2. Like everything else on that port, these **must not throw** for an unreachable
recipient — an undeliverable invite is a `NONE` delivery that ends the call as `NO_ANSWER`.

---

## S-9 — Data model and observability

`call.model.ts`:

| Field | Notes |
|---|---|
| `bookingId` | indexed |
| `initiatedBy` | `CUSTOMER` \| `DRIVER` |
| `customerId`, `driverId` | |
| `status` | `RINGING` \| `ANSWERED` \| `ENDED` |
| `endReason` | `HANGUP` \| `DECLINED` \| `NO_ANSWER` \| `FAILED_ICE` \| `TIMEOUT` \| `NETWORK` |
| `iceConnectionState` | last reported, per party |
| `relayUsed` | did ICE select the TURN candidate? |
| `setupMs` | initiate → answered |
| `durationS` | |
| `createdAt`, `answeredAt`, `endedAt` | |

`endReason`, `relayUsed` and `setupMs` are **not optional telemetry**. They are the evidence
that decides whether this architecture is working, and whether
[S-10](#s-10--failure-modes-and-the-fallback-hook) ever has to fire. Build them in the first
commit, not the tenth.

Admin panel view ([`admin-panel.md`](admin-panel.md)): calls/day, **connect rate**, median
setup time, % relayed, and `NO_ANSWER` rate broken down by driver — a driver with a
persistently high no-answer rate has a handset problem, and that is a supply issue worth
seeing.

---

## S-10 — Failure modes and the fallback hook

Stated plainly, because they will generate the support tickets:

| Failure | Likelihood | Mitigation |
|---|---|---|
| **OEM battery manager kills the driver app; phone never rings** | **Highest risk.** Xiaomi/Redmi, Vivo, Oppo, Realme dominate the driver population | ConnectionService, the duty foreground service, battery-optimisation onboarding. Not fully solvable. |
| Weak data at pickup — basements, crowded markets, congested towers | Common | Fail fast (see below). TURN does not help; this is bandwidth, not NAT. |
| No data at all | Occasional | No call is possible. PSTN would have worked on 2G. |
| Driver already on a GSM call | Occasional | ConnectionService handles it gracefully instead of failing silently. |
| iOS PushKit/CallKit contract violation | Phase 2 only | Report to CallKit immediately; test on a physical device. |

**Expected connect rate: ~92–97%**, against ~99.5% for PSTN masking. That gap is the thing we
bought with the economics in [S-1](#s-1--why-webrtc-and-not-a-telephony-provider).

Three things keep it tolerable:

1. **Fail fast and honestly.** If the call has not connected in ~15s, tell the customer
   "Driver unreachable" and offer something else. Never spin indefinitely.
2. **Canned messages — in v1** ([S-3](#s-3--phasing)). Two taps over the same socket. They work
   on terrible networks, need no push-wake, resolve a large share of pickup coordination without
   a voice call at all, and are the only inbound path to an iOS customer before Phase 2. The
   cheapest reliability win in the feature, which is why they are not held back as a contingency.
3. **The fallback hook.** `InitiateCallUseCase` is the single entry point for every call. If
   the connect rate disappoints, PSTN masking drops in *behind it* as a fallback strategy — no
   client change, no contract change, no rewrite. Keeping that seam is why the masking option
   stays documented rather than deleted.

---

## S-11 — Security rules

1. **Identity comes from the JWT, never from the payload.** Enforced once in `socketAuth.ts`.
2. **Authorisation on every event, not just on initiate.** A `callId` is not a capability;
   `call:sdp` and `call:ice` re-check that the sender is a party to that call.
3. **Relay by lookup, never by client-supplied target**
   ([S-6](#s-6--signalling-event-contract)).
4. **TURN credentials are ephemeral and per-call** ([S-7](#s-7--turn)).
5. **The call window closes** ([S-5](#s-5--the-calls-module)).
6. **No PII crosses the wire** — a first name, nothing else.
7. **Media is never decrypted by us.** DTLS-SRTP end-to-end; coturn forwards ciphertext. This
   also means call recording is impossible without re-architecting, which is a deliberate
   property and not an oversight.
8. **Rate-limit `call:initiate`** per user, consistent with the limits in
   [`architecture.md`](architecture.md) §Security.

---

## S-12 — Testing

| Level | What |
|---|---|
| Unit | `callWindow.ts` authorisation matrix — wrong booking, wrong role, wrong status, expired window, unassigned driver. **The one that must have no holes.** |
| Unit | HMAC credential format against a known `coturn` vector |
| Unit | `expireCall` scheduling and cancellation |
| Integration | Two `socket.io-client` instances driving initiate → sdp → ice → hangup, asserting **no event ever reaches a third socket** |
| Manual (mandatory) | A cheap Redmi on **real mobile data, not wifi**, app backgrounded 30+ minutes, screen off |
| Manual (mandatory) | Customer and driver on **different carriers** — this is what exercises the TURN path |

Emulator and wifi testing will not surface any of the failures in
[S-10](#s-10--failure-modes-and-the-fallback-hook). Treat a green CI run as necessary and
nowhere near sufficient.

---

## S-13 — Documents this changes

To be amended in the same PR as the implementation, so the docs never describe a telephony
provider we do not use:

| File | Change |
|---|---|
| [`../prd.md`](../prd.md) §FR-B8 | "driver contact via masked number" → in-app voice call |
| [`architecture.md`](architecture.md) §Security | Replace the masking guarantee with the E2E-encrypted, no-number guarantee |
| [`api-contracts.md`](api-contracts.md) | Drop `customer.masked_phone`; add §Realtime call events |
| [`booking-lifecycle.md`](booking-lifecycle.md) `→ ASSIGNED` | "push driver details + masked number" → driver details only |
| [`driver-app.md`](driver-app.md) `DRIVER_EN_ROUTE`, `STARTED` | "masked call" → in-app call |
| [`roadmap.md`](roadmap.md) | Add Phase 7.5 |
| [`../decision-log.md`](../decision-log.md) | New entry for the reversal, referencing [S-1](#s-1--why-webrtc-and-not-a-telephony-provider) |

Masking stays described as the **named fallback** in this document. It is not deleted from the
product's thinking, only from its critical path.

---

## S-14 — Effort and build order

| Step | Work | Est. |
|---|---|---|
| 1 | Socket.IO gateway, handshake auth, Redis adapter, shutdown wiring | 2–3 d |
| 2 | `calls` module: domain → use cases → gateway, integration-tested headlessly | 3–4 d |
| 3 | `coturn` install, config, firewall, credential minting (verify with `trickle-ice`) | 1 d |
| 4 | Shared mobile package: call engine + **the one Android receiver both apps mount** | 4–5 d |
| 5 | Driver app: call screen, initiate and receive | 3–4 d |
| 6 | Customer app: call screen, initiate; receive on Android | 2–3 d |
| 7 | Canned messages, both apps, both directions | 1–2 d |
| 8 | Admin call metrics | 1 d |
| 9 | Real-device testing and hardening | 3–5 d |
| | **Phase 1 total** | **~3.5 weeks** |
| | Phase 2 — iOS PushKit/CallKit + `apns.pushSender.ts` | +1–2 weeks |

Both call directions plus canned messages cost roughly **half a week more than
customer-initiated calls alone**, because step 4 builds the receiver once and steps 5 and 6 each
mount it. Splitting them across releases would have cost more than building them together.

Step 1 is worth doing first regardless of this feature: it unblocks the offers and tracking
realtime work that [`dispatch-and-assignment.md`](dispatch-and-assignment.md) and
[`driver-app.md`](driver-app.md) both assume.

---

## S-15 — Concurrency: more than one call at once

Two separate questions live here. The capacity one is easy; the one about the same *person*
being in two calls is where the bugs are.

### Capacity

| | |
|---|---|
| **P2P calls** | Unbounded from our side. The audio never touches the VM — signalling is a few KB during ~2s of setup and then the server is idle. |
| **Relayed calls** | Bounded by the `coturn` port range in [S-7](#s-7--turn). Each allocation consumes one relay port and a call may need one per side, so `49160-49200` ceilings us at **~20–40 concurrent relayed calls**. |
| **CPU / RAM** | Not the constraint. `coturn` is C packet-forwarding; 2 vCPU handles several hundred relayed sessions. |
| **Network** | Not the constraint. 80 kbps per relayed call against the instance's multi-Gbps egress. |
| **Socket.IO** | Not the constraint. Thousands of idle connections fit in 4 GB. |

At 10–20 calls/day the realistic peak is **1–2 concurrent calls**, so the port range gives
10–20x headroom. Widening it plus the matching firewall rule is the whole change if that ever
stops being true; nothing else in this design is affected.

### One active call per user

**Invariant C-1: a user id appears in at most one call with status `RINGING` or `ANSWERED`.**

Four situations make this necessary, and all four are reachable in normal use:

| Situation | Without the invariant |
|---|---|
| Customer double-taps Call | Two `Call` rows, two pushes, the driver's handset rings twice |
| A user has two devices logged in | `call:incoming` fans out to every socket in `user:<role>:<id>`; both ring, both can answer |
| Driver is already on an in-app call | A previous customer calling within the [S-5](#s-5--the-calls-module) post-trip window reaches a driver mid-trip with someone else |
| Customer holds several bookings | Two drivers can ring the same customer — scheduled bookings make this ordinary |

Rules:

1. **Callee busy** — reject `call:initiate` with `CALLEE_BUSY`. The caller is told "Driver is on
   another call". **No push is sent**; ringing a handset that is already in a call is how you
   get a driver to silence notifications permanently.
2. **Caller busy** — reject with `ALREADY_IN_CALL`.
3. **Initiate is idempotent.** If an active call already exists for that `(bookingId, initiator)`
   pair, return the **existing** `callId` rather than creating a second. This is what absorbs
   the double-tap, and it is cheaper than debouncing on two clients.
4. **First answer wins.** `answerCall` performs an atomic compare-and-swap on
   `RINGING → ANSWERED`. Devices that lose receive `call:ended { reason: ANSWERED_ELSEWHERE }`
   and dismiss their ringer.

Rule 4 is not a new pattern. `claimForDriver` already refuses anything but a `SEARCHING`
booking with no driver, and [`../decision-log.md`](../decision-log.md) records that
compare-and-swap as the sole guarantee behind invariant B-2. `answerCall` uses the identical
`findOneAndUpdate`-with-status-condition shape. **Read-then-write loses the race** — with two
devices on one account the window is milliseconds wide and it will be hit.

Enforce C-1 in `callWindow.ts` alongside the authorisation rules, so a single place decides
whether a call may exist at all. Partial indexes on `{ customerId, status }` and
`{ driverId, status }` over the active statuses make the busy check one indexed read.

---

## Open questions

Track in [`open-questions.md`](open-questions.md) when this doc is signed off:

1. **Post-trip call window** — 2h proposed. Long enough for a forgotten-item call, short enough
   that it is not a standing line to a stranger. Needs an ops decision.
2. **Which canned messages, exactly?** The enum is fixed at build time and rendered per-locale
   ([S-6](#s-6--signalling-event-contract)), so the list needs an ops decision before v1.
   Starting proposal — driver: "I've arrived", "I'm at the gate", "2 minutes away", "I can't
   find your car"; customer: "Coming down now", "5 minutes please", "Car is in the basement".
3. **What share of customers are on iOS?** This is the sizing input for Phase 2
   ([S-3](#s-3--phasing)) and nothing else in the plan depends on it. Measure it in the pilot
   before committing the PushKit fortnight.
4. **Connect-rate threshold that triggers the PSTN fallback** — ~92% proposed, needs sign-off
   before the pilot so it is a pre-committed trigger and not a judgement call under pressure.
5. **Can a customer hold two active bookings at once?** Scheduled bookings suggest yes, which is
   what makes the multi-caller row in [S-15](#s-15--concurrency-more-than-one-call-at-once) real
   rather than theoretical. Confirm against [`booking-lifecycle.md`](booking-lifecycle.md).
6. **Does `coturn` stay on the app VM?** Fine now. Should move to its own instance well before
   the `architecture.md` §Scale year-1 target.
