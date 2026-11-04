# ADR 0002: Shared Core Store Across Desktop and Mobile

Date: 2026-03-06
Status: Accepted

## Context

Stride supports desktop and mobile clients with the same GTD concepts, sync rules, and storage model. Duplicating store logic per platform would increase drift risk in critical areas such as:

- task/project/area mutation behavior
- recurrence and checklist rules
- sync normalization and tombstone handling
- search/query semantics

At the same time, each platform still needs its own shell, UI conventions, and storage/runtime adapters.

## Decision

We keep the domain model and primary Zustand store in `packages/core`, and treat desktop/mobile as platform shells around that shared core.

Platform-specific code is allowed to vary in:

- UI components and navigation
- local storage adapter wiring
- native integrations
- diagnostics and packaging behavior

But the data model, merge rules, and store actions remain shared unless there is a strong platform constraint that forces divergence.

## Consequences

- Data-integrity fixes can usually be implemented once in `packages/core`.
- Desktop and mobile stay behaviorally aligned for core GTD operations.
- Platform apps still need adapter glue and targeted tests around local integrations.
- Large changes in `packages/core` require extra care because they affect every client.
