# Improve audit: reliability, security, and operations

Audit base: `faea7edc3e7d04d67540ada3a59ce4d367133377`

## P1: Bind desktop credentials atomically to endpoints

### Problem

WebDAV, self-hosted cloud, and email setters can mutate a keyring credential before durably publishing its endpoint configuration. Public and secret configuration files are also published separately. Failure or interruption can pair a new credential with an old endpoint and send it to the wrong server.

### Scope and design

- Add owner-only durable binding state per service containing a generation and fingerprints of the endpoint identity and credential, never secret values.
- Publish the binding only after keyring and file state are written and read back successfully.
- Snapshot prior state and attempt rollback for ordinary failures; readers must still fail closed on any binding mismatch.
- Make public/secret configuration publication atomic, durable, and crash-recoverable as one logical generation.
- Cover set, replace, clear, keyring-unavailable, and portable plaintext fallback.
- Do not change mobile SecureStore, network protocols, fields, or Dropbox's existing transaction.

### Acceptance

- Injected interruption after each publication stage yields either the complete prior pair or an explicit fail-closed error.
- No transport mock observes a mixed endpoint/credential pair.
- Full Rust library tests/check and desktop typecheck pass.

## P1: Gate dependency changes before merge

### Problem

The dependency audit runs only weekly or manually, so a lockfile or manifest PR can merge a known high advisory before detection.

### Scope and design

- Add a `pull_request` trigger scoped to Bun/workspace manifests and lockfile, EAS CLI manifests/lockfile, desktop Cargo manifests/lockfile, the workflow, and its governance test.
- Preserve schedule/manual triggers and exact current advisory exceptions.
- Extend governance tests to assert trigger paths and audited manifest coverage.
- Split jobs by changed ecosystem only if needed; never omit an ecosystem.

### Acceptance

- Fixtures for every supported manifest select the correct audit job.
- Governance, exact Bun audit, EAS npm audit, and workflow syntax checks pass.

## P2: Durably publish cloud data and attachments before success

### Problem

Cloud JSON and attachment writes use temp plus rename but do not sync the temporary file or destination directory before returning success. A power loss can erase an acknowledged commit.

### Scope and design

- Factor a cloud-local durable atomic publication helper: exclusive temp create, full write, file sync, close, rename, parent-directory sync.
- Preserve root/symlink checks immediately before attachment publication, file modes, locking, cache invalidation, and temp cleanup.
- Propagate any unsupported or failed durability stage as 5xx.

### Acceptance

- Injected filesystem tests prove `write -> fsync temp -> close -> rename -> fsync parent -> success`.
- Failure at every stage preserves the destination where applicable, cleans temps, and never acknowledges success.
- Cloud focused tests, typecheck, and lint pass.

## P3: Return privacy-safe request correlation on every cloud response

### Problem

A request ID is created for every request but returned only with internal 500 responses. Success, validation, rate-limit, authorization, and timeout responses cannot be correlated with server logs.

### Scope and design

- Wrap dispatch so every response carries `X-Request-Id`.
- Emit one structured completion record with ID, method, canonical route, status, and elapsed time.
- Log failures and slow requests by default; gate all-request logging behind explicit configuration.
- Never log raw URLs, queries, credentials, namespace hashes, entity IDs, attachment paths, names, or content.
- Preserve response bodies, streams, CORS, and error payloads.

### Acceptance

- Success, validation, rate-limit, timeout, and internal-error tests receive the same ID as their completion record.
- Redaction tests prove secrets and identifiers are absent.
- Cloud focused tests, typecheck, and lint pass.
