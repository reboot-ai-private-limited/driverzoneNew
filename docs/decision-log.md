# Decision Log

Decisions that have been **made**, newest first, with what they replaced and what they cost.

Three files cover decisions and they do not overlap:

| File | Answers |
|---|---|
| [`LLD/12-open-questions.md`](LLD/12-open-questions.md) | What is **not yet decided** — assumptions A1–A12 and the open items that block build |
| [`engineering/06-tech-choices.md`](engineering/06-tech-choices.md) | **Current state**: what we use and why, written in the present tense |
| this file | **History**: when it changed, what it replaced, what was rejected |

When an open question closes: add an entry here, rewrite `06-tech-choices.md` (or the relevant
LLD doc) to describe the new present, and strike the item from `12-open-questions.md`. This log
is append-only — entries are never edited to match a later reversal. A reversal is a new entry
that references the old one.

Keep entries short. If the reasoning needs more than a paragraph it belongs in a doc, and the
entry links to it.

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

**Consequences:** `docs/engineering/11-adding-a-module.md` step 9 is now "build it in
`container.ts`, mount it in `routes.ts`". The ESLint boundary exemption moved from `routes.ts`
to `container.ts`; `routes.ts` is deliberately left unexempted, so the rule keeps watching the
file most likely to grow a shortcut.

**Refs:** [`engineering/03-module-anatomy.md`](engineering/03-module-anatomy.md)

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
booking→ledger write in [`LLD/05-pricing-and-commission.md`](LLD/05-pricing-and-commission.md),
fails with `Transaction numbers are only allowed on a replica set member or mongos`, months
away from the setup that caused it.

**Consequences:** None at runtime. The single-node replica set was already required; this just
makes the client agree.

**Refs:** `df93f98`
