# Improve audit: product quality

Audit base: `faea7edc3e7d04d67540ada3a59ce4d367133377`

These plans preserve Stride's automatic, progressively disclosed UX. They do not add settings, confirmation prompts, or new concurrent transfer behavior.

## P1: Surface terminal persistence failures globally with retry

### Problem

`updateSettings` resolves after enqueueing a debounced save, while terminal persistence failure occurs later in `flushPendingSave`. The failure is stored in generic `state.error`, auto-clears, is visible only in desktop Focus, and has no mobile surface. A Settings screen can therefore report success although the durable write later fails.

### Scope and design

- Add structured ephemeral `persistenceFailure` state and a coalescing `retryPersistence` action in core.
- Set the state only after save retries are exhausted or the queue overflows; clear it only after a later durable save succeeds.
- Retry the latest authoritative snapshot through the existing queue and barrier; never bypass ordering or overwrite newer queued state.
- Render one localized, app-global desktop and mobile error surface with an accessible Retry action.
- Keep unrelated generic errors on the existing path and keep storage detail in diagnostics.

### Acceptance

- Five failed writes expose one structured failure; a successful retry clears it; concurrent retries coalesce.
- The alert appears outside Focus on desktop and on every mobile route.
- Ordinary UI errors do not create persistence alerts.
- Focused core/root tests, all platform typechecks, i18n parity, and full verification pass.

## P1: Track the exact active transfer operation

### Problem

Desktop and mobile collapse all importers into `import`; mobile also collapses all recovery snapshots into `snapshot`. Every importer or snapshot row therefore appears busy for one operation.

### Scope and design

- Replace the coarse state with explicit operation IDs: `export`, `restore`, `merge`, `import:todoist`, `import:ticktick`, `import:dgt`, `import:omnifocus`, `import:stride-csv`, plus `snapshot:<stable-name>` on mobile.
- Set and clear the exact ID across picker, preview, cancellation, confirmation, success, and error paths.
- Continue disabling competing actions, but render progress and accessibility busy state only on the active row.
- Do not parse an operation ID from translated display text.

### Acceptance

- Exactly one importer or snapshot row displays activity.
- Cancellation and exceptions always clear the operation.
- Hook/component regressions cover all operation IDs and platform typechecks pass.

## P1: Keep mobile onboarding open while seeding

### Problem

Android Back invokes `Modal.onRequestClose={onSkip}` even while Start Fresh is seeding. Visible controls are disabled, but the system dismissal can close the flow while asynchronous seed/navigation work continues.

### Scope and design

- Guard `onRequestClose` with the same busy rule as all visible dismiss actions.
- Add disabled/busy accessibility state to onboarding actions.
- Preserve retry after a failed seed and keep the three existing choices.
- Correct the public Getting Started guide to say Start Fresh creates and opens the localized Getting Started project.

### Acceptance

- Back/close does nothing while busy and invokes `onSkip` once when idle.
- Failed seeding leaves the flow open and usable.
- Focused mobile tests/typecheck and the public-docs check pass.

## P2: Localize all desktop Settings feedback

### Problem

Sync, GTD/Pomodoro, AI, and Calendar Settings still contain direct English toast/error copy. Some strings reach users through `reportError`, so they are not merely diagnostic labels.

### Scope and design

- Inventory direct user-visible strings in the audited Settings hooks and components.
- Add/reuse semantic locale keys and pass localized safe messages separately from diagnostic labels.
- Preserve arbitrary backend error text as detail; never treat it as a translation key.
- Add a ratchet test for direct literals passed to visible Settings error/toast APIs.

### Acceptance

- Focused Settings tests prove non-English translator output for every migrated surface.
- The ratchet permits developer logs but rejects new visible English literals.
- Desktop typecheck, i18n parity, and full verification pass.

## P2: Give mobile Data and Recovery rows complete accessibility semantics

Depends on exact transfer operation state.

### Problem

Export, restore, merge, importer, and recovery snapshot rows omit complete button, disabled, and busy semantics; decorative status elements can be announced independently.

### Scope and design

- Give every action row button role, concise localized label/hint, and `{ disabled, busy }` derived from the exact operation.
- Give each recovery snapshot a unique accessible name.
- Hide decorative icons, chevrons, and spinners from the accessibility tree.
- Preserve layout and progressive disclosure.

### Acceptance

- Tests enumerate every revealed row and assert role/state/name.
- During one transfer only its row is busy while competing rows are disabled.
- Focused mobile tests and typecheck pass.
