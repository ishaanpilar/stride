# 23. Unified Projects-view DndContext

Date: 2026-07-04

## Status

Accepted

## Context

The desktop Projects view accumulated four separate dnd-kit `DndContext`s: one in the
workspace for task reordering, and one per sidebar project group (active, deferred,
archived) for project reordering and project→area moves (#812). dnd-kit drags cannot
cross context boundaries, so a task row could never reach a sidebar project — the
remaining half of #812 (moving tasks between projects by drag) was structurally
impossible. Alternatives considered: native HTML5 drag from the row body reusing the
calendar-drag pipeline (two competing drag gestures per row, and it re-introduces the
text-selection conflict fixed in #815), and manual `elementFromPoint` hit-testing on
top of the existing workspace context (bypasses dnd-kit's collision model with
hand-rolled glue).

## Decision

The Projects view hosts a single `DndContext` spanning sidebar and workspace. Every
draggable declares typed data (`{ type: 'task', sortable }` or
`{ type: 'project', section }`), and a single collision-detection function branches on
the active drag's type: project drags only see containers of their own sidebar
section (preserving the old per-section boundaries), task drags see the task list
(only in manual-order mode) plus non-archived sidebar project rows and area zones.
Area drop-zone ids are namespaced by section (`project-area:<section>:<areaId>`)
because the same area can render a zone in several sections under one context. A
`DragOverlay` carries the task chip across panel scroll containers; drops on sidebar
targets write through the existing core container-assignment path in `updateTask`.

## Consequences

One drag gesture (the grip handle) now serves in-list reorder and cross-panel moves,
and new drop targets only need a droppable with typed data plus a branch in the
drag-end dispatcher. The cost is that all Projects-view drag interactions share one
sensor configuration and collision function, so changes there must consider every
drag type; the typed-data filters are the guard rails that keep the old behaviors
(project reorder, project→area, task reorder) isolated from each other.
