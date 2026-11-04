# Improve audit: architecture and performance

Audit base: `faea7edc3e7d04d67540ada3a59ce4d367133377`

## P1: Make SQLite connection setup cheap after initialization

### Problem

Every `open_sqlite` call performs complete schema/column/index migration checks and data-dependent FTS verification. Hot task reads and writes therefore pay DDL and store-sized scan costs even when the database is current.

### Scope and design

- Split per-connection pragmas from one-time/versioned schema initialization.
- Add a persistent current-schema marker with a concurrency-safe double-check under `BEGIN IMMEDIATE`.
- Add a cheap warm-state guard keyed by resolved DB path and SQLite schema generation so DB replacement or external DDL invalidates it; never rely only on process-global state.
- Run FTS content verification during initialization, explicit rebuild/migration, and FTS search repair—not ordinary saves/non-FTS queries.
- Expose a path-based connection helper for tests. Do not add pooling or alter the schema/domain model.

### Acceptance

- Warm opens execute no DDL, FTS population scans, or immediate initialization transaction.
- Concurrent first opens initialize once; failed initialization retries; DB replacement/schema changes invalidate readiness.
- Every connection keeps foreign keys/timeouts and FTS search still repairs drift.
- Rust initialization/FTS tests and full library test pass.

## P1: Give the local data watcher a partial-failure-safe lifecycle

### Problem

The watcher stores roughly 25 module globals. If one of JSON/SQLite registration succeeds and the other fails, any handle makes future `start` calls return, permanently disabling the missing channel. A registration resolving after `stop` can also leak.

### Scope and design

- Encapsulate state and dependencies in `LocalDataWatcherController`, retaining the current singleton facade.
- Give JSON and SQLite channels independent handle/path/attempt/retry state.
- Capture lifecycle generation across awaited registration; immediately unwatch late results after stop/restart.
- Retry only the missing channel with bounded backoff and cancel retries on stop.
- Make start/stop idempotent and tests instance-based.
- Preserve merge rules, timing windows, write serialization, filtering, and log wording.

### Acceptance

- Either channel can fail and retry without duplicating the successful one.
- Stop-before-resolution disposes the late handle; restarts install exactly one handle per channel.
- Two controllers share no timers, promises, hashes, or payloads.
- Existing watcher behavior and new lifecycle interleavings pass focused tests/typechecks/lint.

## P2: Share golden merge-arbitration fixtures between TypeScript and Rust

### Problem

Core synchronization and native persistence duplicate revision, timestamp, skew, tombstone, and deterministic-tie arbitration rules and constants. Separate tests cannot prevent cross-runtime divergence.

### Scope and design

- Add one JSON fixture with fixed left/right records, merge time, forward/reverse winner, convergence, and category.
- Exercise public `mergeAppData(..., { nowIso })` in TypeScript.
- Extract a deterministic Rust snapshot-merge-at-time seam and consume the same fixture; production still supplies current UTC time.
- Cover revision dominance, offsets/date-only/invalid timestamps, future clamping, `revBy`, revisionless skew, delete/live combinations, backup resurrection, `purgedAt`, and exact comparable-signature ties.
- Add fixture category/cardinality assertions. Core/ADR behavior remains authoritative.

### Acceptance

- Both runtimes read the exact same fixture.
- Convergent cases produce identical winners in both input orders; declared direction-dependent ties match.
- A rule change fails both parity gates until deliberately reconciled.
- Core sync and Rust storage parity/full suites pass.
