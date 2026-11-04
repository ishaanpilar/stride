# ADR 0006: Zustand as the Primary Shared State Model

Date: 2026-03-14
Status: Accepted

## Context

Stride needs one state model that can be shared across desktop and mobile while remaining usable from React components, background sync code, notifications, widgets, and other imperative integration points.

The store also has to coordinate:

- task/project/section/area mutations
- local persistence and save queues
- sync metadata and reconciliation
- behavior that must run outside a mounted React tree

## Decision

We keep Zustand as the primary shared state model in `packages/core` and build thin platform adapters around it.

React components consume store slices as usual, while platform services can also access the same store imperatively through `useTaskStore.getState()` when they need shared business logic outside the UI tree.

## Consequences

- Core GTD behavior remains aligned across desktop and mobile.
- Background services such as sync, notifications, and widgets can reuse the same actions and derived state.
- The shared store must stay disciplined: platform-specific side effects belong in adapters and services, not in generic core state mutations.
- As the codebase grows, large store-adjacent modules should be split along runtime boundaries rather than replacing the state model wholesale.
