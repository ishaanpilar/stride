# ADR 0010: Self-Hosted Cloud Sync Server

Date: 2026-04-24
Status: Accepted

## Context

Stride supports BYOS sync through file sync, WebDAV, Dropbox in supported builds, iCloud on Apple platforms, and the optional self-hosted cloud server.

The cloud server is intentionally small:

- it stores one JSON snapshot namespace per bearer token
- it stores attachments separately under sanitized paths
- it uses the shared core merge logic instead of inventing server-only conflict rules
- it is meant for self-hosting behind HTTPS, not as a multi-tenant hosted SaaS

The main risk is treating the server as a general collaboration backend. That would pull Stride toward account management, per-row authorization, real-time fan-out, and operational complexity that does not fit a personal local-first GTD app.

## Decision

Stride keeps the cloud server as a self-hosted sync endpoint.

Server responsibilities are limited to:

1. Authenticate requests with bearer tokens or an explicit token-namespace opt-in.
2. Map each token to an isolated namespace.
3. Validate incoming snapshots and task mutation payloads.
4. Serialize read-modify-write operations per namespace across every server process that shares the data directory.
5. Merge incoming snapshots with existing on-disk state using shared core sync semantics.
6. Store attachments with path traversal and executable-content protections.
7. Admit the first durable namespace write under a process-safe global lock so the configured namespace cap cannot be oversubscribed by concurrent tokens.

Clients remain responsible for normal app state, local SQLite persistence, and user-facing sync recovery. The cloud server must not become a separate product-state authority with divergent merge behavior.

## Consequences

- The server stays simple to deploy and reason about.
- Sync behavior remains consistent between local, WebDAV/file, and cloud paths because the same core merge rules are used.
- Concurrent writes need per-namespace serialization to avoid file-level lost updates. Process locks use a bounded set of SQLite lock shards so attacker-controlled tokens cannot create unbounded lock files; the operating system releases each transaction when a worker exits. Timestamp-based stale-lock deletion is not safe.
- Dynamic namespace quota checks and reservation of a valid empty sync document form one short critical section across processes. Existing namespaces do not take that global admission lock, and request bodies are read only after admission is released.
- Operators must handle TLS, token secrecy, reverse proxy configuration, backups, and host hardening.
- If Stride later needs hosted multi-user collaboration, that should be a separate ADR because it would require a different trust, authorization, and storage model.
