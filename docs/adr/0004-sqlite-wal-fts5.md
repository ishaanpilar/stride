# ADR 0004: SQLite WAL and FTS5 as the Default Local Persistence Stack

Date: 2026-03-14
Status: Accepted

## Context

Stride is local-first and needs a single persistence approach that works across desktop and mobile without introducing a separate database service or sync-specific storage tier.

The storage layer needs to support:

- offline reads and writes with low operational overhead
- safe concurrent access patterns from app code and background work
- predictable snapshots for sync/export
- fast full-text search over tasks and projects

Using SQLite with write-ahead logging (WAL) and an FTS5 index keeps the storage model embedded and portable while still covering those requirements.

## Decision

We use SQLite as the primary local store, enable WAL mode, and maintain FTS5-backed search indexes for task/project search.

This remains the default persistence stack for desktop and mobile adapters unless a platform constraint forces a temporary fallback path.

## Consequences

- Search stays local and fast without introducing an external search service.
- Readers can continue while writes are in progress, which fits Stride's offline-first model better than a single locked JSON file.
- We must manage schema migrations, FTS index rebuilds, and corruption recovery explicitly in application code.
- JSON backups and exports remain important as portability and repair mechanisms, but they are not the primary runtime store.
