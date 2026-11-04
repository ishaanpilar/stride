# ADR 0016: Serialize Sync Cycles Around The Merge/Write Window

Date: 2026-05-06
Status: Accepted

## Context

Desktop and mobile can request sync from multiple triggers: startup, foregrounding, scheduled background work, manual buttons, and post-save nudges. Without serialization, two cycles can overlap their read, merge, and write windows.

Overlapping cycles can write stale merged snapshots, lose tombstones, or report misleading conflict state even when each individual merge is valid.

## Decision

Serialize `performSyncCycle` in core so only one read/merge/write cycle runs at a time in a process. Follow-up sync requests queue behind the in-flight cycle.

On mobile, sync runs and destructive full-document transfers (import, restore, or replacement) also share a serialized document-operation lane. A transfer takes the store-write barrier only after it reaches the front of that lane; ordinary edits can continue during sync and are handled by the existing freshness check and follow-up sync path.

Tombstone conflict ordering also treats a delete operation's effective time as `max(updatedAt, deletedAt)`. This preserves deletes that received later metadata updates and prevents a live edit between `deletedAt` and a later tombstone `updatedAt` from incorrectly winning.

## Consequences

- Manual and scheduled sync can no longer interleave writes within the same app process.
- Mobile sync cannot interleave its read/merge/write window with a full-document import or restore, regardless of which operation starts first.
- The core merge/write invariant is testable once instead of being reimplemented in desktop and mobile services.
- Cross-device concurrency is still resolved by the sync merge rules; this decision only serializes local in-process cycles.
- A later shared sync runtime can reuse this core behavior rather than adding another platform-level mutex.
