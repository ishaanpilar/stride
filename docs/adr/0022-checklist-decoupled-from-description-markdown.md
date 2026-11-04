# 22. Checklist decoupled from description markdown

Date: 2026-07-03

## Status

Accepted

## Context

The task checklist and markdown checkbox lines (`- [ ]`) in the task description were maintained as two mirrored representations of one list: editing the checklist rewrote the description's task-list lines, and saving a task rebuilt the checklist from the description's markdown whenever any checkbox line was present.

This coupling was the root cause of a data-loss bug class: each side was synchronized by overwriting the other wholesale from potentially stale state. Checklist items built in the UI were silently deleted when a markdown checkbox appeared in the notes; typed markdown lines were deleted by checklist interactions; a fix required stale-state reconciliation machinery (`reconcileChecklistWithMarkdown`, `absorbMarkdownChecklistItems`) whose invariants every future editor feature would have had to preserve. The coupling was also invisible to users — a bug report described checklist items "simply disappearing" with no hint that the notes field was involved.

The original value of the coupling — bulk-entering checklist items by typing a markdown list — is now covered directly by multi-line paste into the checklist field (one item per line, bullet/numbered/`[x]` markers recognized).

## Decision

The task checklist and the description are fully independent:

- Markdown checkbox lines in a description are plain rendered text. They never populate, update, or delete checklist items.
- Checklist edits (toggle, retitle, add, delete, reorder, reset) never modify the description.
- The reconciliation/mirroring machinery is removed from core and both apps (`extractChecklistFromMarkdown`, `syncMarkdownChecklistCompletion`, `syncMarkdownChecklistWithCanonical`, `reconcileChecklistWithMarkdown`, `absorbMarkdownChecklistItems`).
- Bulk entry is served by multi-line paste into a checklist item (`parsePastedChecklistItems` in core).

Existing tasks that carry both mirrored copies keep both; the copies simply stop tracking each other. No automatic migration: guessing which copy to delete risks exactly the data loss this decision removes.

## Consequences

- One writer per surface: the checklist is only edited through the checklist UI, the description only through the text editor. The stale-overwrite bug class is structurally gone.
- Users who relied on typing markdown checkboxes to build checklists must paste the lines into the checklist field instead (documented in the release notes and user guides).
- Tasks with previously mirrored lists display the list twice (notes text plus checklist) until the user deletes one side manually.
