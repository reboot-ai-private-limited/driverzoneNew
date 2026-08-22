# Changelog

Notable changes to this repository. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

There are no releases yet — the first shippable milestone is the phase 9 pilot in
[`docs/LLD/11-roadmap.md`](docs/LLD/11-roadmap.md). Everything lands under `Unreleased` until
then.

This is not the commit log. Commits are written for someone bisecting a regression; this is for
someone coming back after two weeks and asking what moved. For *why* something is the way it
is, see [`docs/decision-log.md`](docs/decision-log.md).

## [Unreleased]

### Added

- `docker-compose.dev.yml` — infrastructure only (Mongo, Redis, OSRM commented out). Ports bind
  loopback and are overridable via `MONGO_PORT` / `REDIS_PORT` / `OSRM_PORT`.
- `docker-compose.prod.yml` — the full stack from built images, with the databases unpublished
  and separate volumes from the dev stack.
- `apps/api/.env.prod.example` — production env template, kept apart from the dev `.env`.
- `docs/setup-development.md` — the setup guide: both compose workflows, the app combinations,
  the mobile-terminal rule, troubleshooting, and a spec for the not-yet-built seed script.
- `docs/decision-log.md` and this changelog.
- Root `dev:*` scripts — `dev:api`, `dev:worker`, `dev:backend`, `dev:web`, `dev:full`,
  `dev:customer`, `dev:driver`.
- `dev:worker` task in `turbo.json`; the API script existed but no task did, so the BullMQ
  worker could not be started through turbo.
- `scripts/check-doc-links.sh`, wired into `pnpm check` — every relative markdown link must
  resolve.

### Changed

- Low-level design docs `02`–`12` moved to `docs/LLD/`. The PRD, `README.md` and
  `setup-development.md` stay at `docs/` root.
- `apps/api/.env.example`: `MONGO_URI` now carries `?replicaSet=rs0&directConnection=true`.
  Without it the first multi-document transaction fails, far from the setup that caused it.

### Fixed

- 44 markdown links and 8 prose references in code, broken by the `docs/LLD/` move.

### Removed

- `docker-compose.yml`. It mixed infrastructure with production application builds, so
  `docker compose up` meant two different things depending on which services you named. Every
  command now names its file with `-f`.
