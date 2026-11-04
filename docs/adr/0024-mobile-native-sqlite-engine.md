# 24. Mobile native SQLite engine (op-sqlite)

Date: 2026-07-12

## Status

Accepted

## Context

The mobile app runs UI, storage, and the whole sync cycle on the single React
Native JS thread (#853, evidence in #766). The #766 beta logs show the JS thread
— not SQLite — as the bottleneck: `BEGIN` awaited up to 16s with
`busy_timeout=5000` and `rowsWritten 0`, while the statements' own SQL time
stayed in the low hundreds of milliseconds. expo-sqlite's modern async API
already executes SQL on a native queue, but every statement round-trips through
Expo Modules' async layer, result conversion lands on the JS thread, and the
engine is only reachable from the main JS runtime — so no part of the
read→merge→write cycle can ever leave that thread.

Issue #853 ranks three options: (1) off-thread JS for the sync cycle,
(2) a native JSI SQLite engine, (3) a shared Rust storage/merge core. Forking
the merge algorithm (option 3) is the main correctness risk and is deliberately
deferred until 1+2 are measured.

## Decision

Replace expo-sqlite with `@op-engineering/op-sqlite` behind the existing
`SqliteClient` seam; the core `SqliteAdapter` (rev-guarded upserts, fingerprint
cache, FTS) is untouched. The client opens the same file expo-sqlite created
(`<documentDirectory>/SQLite/stride.db`), so existing installs upgrade in
place with no migration. FTS5 is enabled via the `op-sqlite` package.json
config (off by default). expo-sqlite is removed entirely rather than kept as a
fallback: op-sqlite documents iOS pod conflicts with other packages that link
SQLite, and Expo Go already runs the JSON/AsyncStorage path
(`Constants.appOwnership === 'expo'`), which stays the fallback when the native
module is unavailable.

Planned follow-up phases under #853, in order: stage the sync cycle's CPU work
(remote payload parse, merge, serialization) on a background JS runtime via
`react-native-worklets` (already a dependency through Reanimated 4), gated on
the rc.6 diagnostics confirming where the refresh/merge time goes; port storage
and merge to a shared Rust core only if that still misses the <100ms
tap-during-sync goal on a 5k-task library.

## Consequences

SQL execution runs on op-sqlite's dedicated per-database native thread with a
cheaper JSI call path than the Expo Modules bridge, and the engine is a plain
JSI host object — the property the phase-2 background-runtime work needs.
Statement semantics are unchanged: one connection, FIFO per database, manual
`BEGIN IMMEDIATE…COMMIT` from the adapter still serializes exactly as before.
The costs: Android/iOS builds now compile SQLite from source (same build class
as whisper.rn, fine for F-Droid), the mobile web/Expo Go targets have no SQLite
at all (JSON path, unchanged in practice), and op-sqlite major upgrades track
React Native majors more aggressively than Expo packages do.
