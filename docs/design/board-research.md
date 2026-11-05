# Stride Board: research and spec

Research date: 2026-11-05. Purpose: replace "rebuilt from memory of Trello" with sourced evidence.

Method and honesty note. Official help docs were fetched and read for Linear, Notion, GitHub Projects, Jira, Trello, Todoist and the Atlassian Design System (drag-and-drop guidelines). The local Apple HIG copy was read for drag-and-drop and scroll views. The vendors almost never publish pixel measurements for their boards (column width, card padding, radius, shadow). Where a number is not in a source it is marked **unverified** and is NOT presented as fact. Asana's help page returned no body text, so Asana facts come from search snippets and forum posts only (lower confidence). Things and Superlist have no kanban board, so they were not researched. Nielsen Norman and Smashing articles were not fetched (no time budget used on them); no claim here depends on them.

Sources key (URLs used):

- [TR1] https://support.atlassian.com/trello/docs/add-and-customize-cards-and-lists/
- [TR2] https://support.atlassian.com/trello/docs/adding-cards/
- [TR3] https://support.atlassian.com/trello/docs/collapse-or-expand-a-list/
- [TR4] https://support.atlassian.com/trello/docs/keyboard-shortcuts-in-trello/
- [TR5] https://developer.atlassian.com/cloud/trello/guides/components/card-components/
- [TR6] https://community.atlassian.com/forums/Trello-questions/Feedback-on-Card-Back-Redesign-Loss-of-efficiency-and/qaq-p/3262304 (user reports; list width not adjustable natively is inferred from repeated third-party requests, low confidence)
- [NO1] https://www.notion.com/help/boards
- [LI1] https://linear.app/docs/board-layout
- [GH1] https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-board-layout
- [JI1] https://support.atlassian.com/jira-software-cloud/docs/configure-columns/
- [JI2] https://support.atlassian.com/jira-software-cloud/docs/what-is-a-jira-software-board/
- [AS1] https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines
- [TD1] https://www.todoist.com/help/articles/use-board-view-in-todoist
- [AA1] Asana: https://help.asana.com/s/article/board-view and forum threads (search snippets only, low confidence)
- [HIG-DD] local HIG drag-and-drop.md (source: https://developer.apple.com/design/human-interface-guidelines/drag-and-drop)
- [HIG-SV] local HIG scroll-views.md (source: https://developer.apple.com/design/human-interface-guidelines/scroll-views)

---

## (a) Comparison table

"n/p" = not published in the source I read. "unverified" = I believe it from memory/use but found no source.

| Specific | Trello | Notion | Linear | GitHub Projects | Jira | Asana | Todoist |
|---|---|---|---|---|---|---|---|
| Column width (px), resizable? | Fixed. A 272px wrapper appears in the developer card-component example [TR5] but that styles the example container, not an official spec. Width not user-adjustable natively (third-party extensions exist to change it) [TR6]. | n/p; card size S/M/L setting [NO1] | n/p | n/p | n/p | n/p | n/p |
| Column gap, card padding, radius, shadow | n/p (unverified) | n/p | n/p | n/p | n/p | n/p | n/p |
| Card content | Title, labels, badges (description, comments, attachments, checklist progress, due + due-complete), members, optional cover [TR1][TR5] | User-chosen properties, order draggable, eye toggle per property; optional preview: page cover, page content, or a files property [NO1] | Properties; descriptions not shown; many properties may not all display [LI1] | Fields chosen via View > Configuration > Fields [GH1] | Not covered on pages read | Custom fields toggleable (forum, low confidence) [AA1] | Task, sub-tasks (expandable on card); completed sub-tasks if enabled [TD1] |
| Checkbox on card | Optional "complete" status on cards [TR1] (not the default control) | A checkbox property can be shown (unverified) | No (status is the column) | No | No | Yes, complete circle (unverified on this page) | Yes, task completion circle (unverified on this page) |
| Header content | Title, collapse button, list menu, color [TR1][TR3] | Title, gray aggregate (count by default, many aggregations), `...` menu with Hide group [NO1] | Title, `+` to create in column, three-dot menu with Hide [LI1] | Title, count shown next to limit, column menu with Set column limit [GH1] | Title, constraint values (min/max) shown at top [JI1] | Section title, `+` beside name, collapse arrow [AA1] | Section name, drag to reorder [TD1] |
| WIP limit | Not native; Power-Up and third-party only (search results) | None found | None found (page does not mention) [LI1] | Yes, advisory only, per view; count highlights when exceeded; never blocks adds or automations [GH1] | Yes, min/max per column; header turns red (max exceeded) or yellow (min unmet); does not hide items [JI1] | n/p | No |
| Collapse column | Yes; collapsed list keeps name and count; `\` while hovering; board menu collapse-all; paid plans [TR3] | Hide group (not collapse) [NO1] | Hide (hidden columns go to far right, still droppable); swimlane rows collapse with `T` [LI1] | Choose which columns to show [GH1] | Not covered | Collapse arrow rolled out (forum, low confidence) [AA1] | No |
| Footer add-card | Yes: "Add a card" at list bottom; type name, Enter. Also top via list menu, middle via double-click between cards [TR2] | n/p (unverified) | `+` at column top [LI1] | n/p | n/p | "+Add task" at section bottom, plus `+` next to name [AA1] | "Add task" in section; `A` adds to first column [TD1] |
| Empty-state | n/p | n/p | "Show empty groups" view option; turn off to hide empty columns [LI1] | n/p | n/p | n/p | n/p |
| Drag affordance | Whole card (Trello drag preview rotates 4deg per Atlassian) [AS1] | Click, hold, drag the card; drag column headings to reorder columns [NO1] | Mouse drag; drop position follows pointer [LI1] | Single or multi-item drag; value updates to the column [GH1] | n/p | Cmd/Ctrl-click multi-select then drag [AA1] | Drag; multi-select drag; sub-tasks not draggable [TD1] |
| Drop indicator | Atlassian system guidance: 2px line (color.border.selected), 8px terminal, centered in the gap between stacked items; background tint (350ms, cubic-bezier(0.15,1,0.3,1)) when dropping INTO a container; no line when no ordering is possible (e.g. empty list) [AS1] | n/p | n/p | n/p | n/p | n/p | n/p |
| Drag preview | Original stays at 40% opacity; preview max 280x280; cards have no offset from grab point; Trello uses 4deg rotation; max 3 pieces of info in preview [AS1] | n/p | n/p | n/p | n/p | n/p | n/p |
| Auto-scroll | Atlassian guideline page does not cover it [AS1]. HIG says containers should scroll as items are dragged near edges [HIG-DD] | n/p | Hold Shift + wheel, trackpad, or click-drag empty space for horizontal scroll [LI1] | n/p | n/p | n/p | n/p |
| Horizontal scroll vs wrap | Horizontal scroll; Shift+wheel [TR4] | Horizontal (unverified on page) | Horizontal [LI1] | Horizontal; add-column button at far right [GH1] | n/p | Horizontal (unverified) | Horizontal; add-section at far right [TD1] |
| Swimlanes / grouping | No native | Sub-groups by a second property [NO1] | Rows by team, cycle, assignee, etc.; collapsible [LI1] | Group by field creates horizontal sections [GH1] | Swimlanes (agent swimlanes on the page read) [JI2] | n/p | No |
| Hover quick actions | Hover shortcuts: `t` edit title, `c` archive, `n` new card below [TR4] | n/p | `Space` while hovering peeks at details [LI1] | n/p | n/p | n/p | n/p |
| Keyboard | `j`/`k` or arrows select card above/below; Enter opens hovered card; `z` undo [TR4][TR2] | n/p | `X` select, `Shift+X` multi-select, `Alt+Shift+Up/Down` to top/bottom of column, `S` set status (lands at top), `Cmd/Ctrl+B` toggle board, `T` swimlane toggle [LI1] | n/p | n/p | n/p | `Shift+V` view toggle, `A` add to first column, `S` add section [TD1] |
| Done-column behaviour | Plain list; archive cards; "complete" is a card flag [TR1] | Just another status group | Last status group; columns always run first to last status [LI1] | Just a Status value | Only the right-most column = done, always green; with no sprints, done items auto-removed from the board after 14 days [JI1][JI2] | n/p | Completed tasks are removed from the card list; sub-tasks shown if option on [TD1] |
| Density options | Compact card mode is requested by users, not native (search results) | Card size small/medium/large [NO1] | n/p | Choose fields [GH1] | n/p | Compact view requested on forum (not confirmed native) | Per-card collapse/expand of sub-tasks; collapse-all shortcut [TD1] |
| Sorting vs manual order | Cards sortable per list [TR1] | n/p | Board and list orderings are linked; cannot be ordered independently [LI1] | While sorted you cannot manually reorder within a column, but can still move across columns [GH1] | n/p | n/p | "Add task above/below" unavailable while sorted [TD1] |
| Mobile / narrow | Horizontal scroll; n/p | n/p | n/p | n/p | n/p | n/p | Boards not available in Upcoming on iOS/Android; mobile drags the Add Task card [TD1] |

Apple HIG (macOS) points relevant to a board:

- Provide non-drag alternatives such as menu commands [HIG-DD].
- Prefer letting people undo a drop [HIG-DD].
- Show feedback only while the dragged item is over a valid destination, and remove it when it leaves [HIG-DD].
- When a drop fails, the item should return to its source or scale up and fade out [HIG-DD].
- Auto-scroll the destination while dragging [HIG-DD].
- Make it apparent content is scrollable by showing partial content at the edge [HIG-SV].
- A horizontal scroll view inside a vertical one is fine; avoid same-orientation nesting [HIG-SV].
- Support default scrolling gestures and keyboard shortcuts [HIG-SV].

---

## (b) The common framework (the must-haves)

Everything below appears in at least two independent sources, and most in all of the products that have the concept.

1. Columns are values of one field (status/section). Dragging a card into a column writes that field. [GH1][LI1][NO1][TD1]
2. Fixed-width columns in a horizontal strip; each column scrolls vertically on its own; the board scrolls horizontally with trackpad/Shift+wheel. [TR4][LI1][GH1][HIG-SV]
3. A column header shows title and card count, plus a menu. Menu actions found across products: hide, collapse, limit, color. [NO1][LI1][GH1][TR3]
4. An add-card affordance inside each column (bottom in Trello/Asana/Todoist, top `+` in Linear). Typing a title and pressing Enter creates the card (Trello). [TR2][LI1][AA1][TD1]
5. Cards are compact: title plus a few property chips; descriptions are not shown on the card (Linear), properties are user-selectable (Notion, GitHub). [LI1][NO1][GH1]
6. Whole-card drag with an insertion indicator, original left at 40% opacity, a lifted preview (Trello rotates 4deg). [AS1]
7. A non-pointer way to do the same move: Atlassian says put move actions in the "more actions" menu; Linear has keyboard moves; HIG demands alternatives. [AS1][LI1][HIG-DD]
8. When a sort is applied, manual reordering is disabled but cross-column moves still work. [GH1][LI1]
9. The last column is "done" and is treated differently from the rest (Jira: green, auto-aged out; Linear: last status). [JI1][JI2][LI1]
10. Optional second dimension (swimlanes/sub-groups) and optional WIP limits exist, but are opt-in and advisory (GitHub never blocks; Jira only colors). [NO1][LI1][GH1][JI1]

### Where products differ, and the pick for Stride (one person, one Mac)

| Decision | Options in the wild | Stride choice and why |
|---|---|---|
| Add card | Bottom inline composer (Trello, Asana, Todoist) vs top `+` (Linear) | Bottom inline composer with Enter, plus the header `+`. Single user capturing quickly benefits most from not opening a modal. |
| Column menu | Notion/Linear/GitHub/Trello all have one | Add one. It is where "hide", "collapse", "sort", "clear done" and "add card at top" live. |
| Collapse vs hide | Trello collapses, Linear/Notion hide | Support collapse (keeps count visible, drop target stays alive) and hide through the same menu. Linear's hidden-column-still-droppable idea is worth copying for Someday. |
| WIP limits | Advisory (GitHub), colored (Jira), none (Linear, Notion) | No. See section (d). |
| Swimlanes | Linear, GitHub, Notion, Jira | Not now (see section e). |
| Cover images / avatars | Trello, Notion | Skip: single user, no assignees. |
| Done column | Jira ages out after 14 days; others keep all | Show recent completions only, with a "Show older" row. Recommendation, not a copy of a source number. |
| Card density | Notion S/M/L | Keep the existing Stride density setting (comfortable / compact) wired to padding. |

---

## (c) Current Stride board: what is right, what is missing

Files read: `apps/desktop/src/components/views/BoardView.tsx`, `board/BoardCard.tsx`, `board/BoardColumn.tsx`, `board-view-dnd.ts`, `docs/design/stride-soft-ui.md`, and test titles in `BoardView.test.tsx` and `board-view-dnd.test.ts`.

### Done right

- Whole-card drag, original at `opacity-40`, lifted overlay with `rotate-2`. Matches [AS1] (40% opacity, Trello-style rotation; Trello's is 4deg, Stride's `rotate-2` is 2deg: fine).
- Insertion line for reorder, tinted background for dropping into an empty column, no line when there is no ordering. Matches the [AS1] rule "line for relative placement, background for container".
- Cards do not displace each other (strategy returns null), so the line is the only signal.
- Cross-column writes status; reorder is disabled under a non-default sort with an explanatory hint. Matches [GH1][LI1].
- Keyboard: Alt+Arrow moves across and within columns; Space starts keyboard drag; Enter opens; live region announces the move. Strong versus most vendors. [LI1][HIG-DD]
- Independent vertical scroll per column, horizontal scroll for the strip, thin scrollbars. [HIG-SV]
- Columns hold title, status dot, count, `+`; footer add. Good basic anatomy. [TR2][NO1]
- Title clamps to 3 lines, chip row wraps, nothing absolutely positioned over the title. Good.
- Tests exist for drag resolution, keyboard moves, empty column, fixed width, done styling.

### Gaps

| # | Priority | Gap | Evidence | Concrete fix |
|---|---|---|---|---|
| 1 | High | No column menu at all. Every sourced product has one. | [NO1][LI1][GH1][TR1] | Add a 28x28 `ellipsis` icon button after `+` in the header opening a menu (see section d for contents). |
| 2 | High | "Add a card" (header `+` and footer) dispatches the global quick-add modal (`stride:quick-add`) rather than adding in place. Capturing a title costs a modal round trip. | [TR2] Trello inline composer, Enter to create | Footer button turns into an inline composer: a `textarea` (1 row, auto-grow, same card surface and radius) at the bottom of the column; Enter creates, Shift+Enter newline, Escape cancels, composer stays open for the next card; new card scrolls into view. Keep the modal for the header `+` only if you want, or for "More options...". |
| 3 | High | No pointer-free alternative other than Alt+Arrow (undiscoverable) and no right-click/menu move. Atlassian explicitly says to put move actions in a "more actions" menu; HIG says provide alternatives. | [AS1][HIG-DD] | Add a context menu on a card (right-click and a hover `...` button, 24x24, top-right of the card, visible on hover and on focus): Open, Move to > (column list, current disabled), Move to top, Move to bottom, Mark done, Focus today, Delete. |
| 4 | Medium | Done column: cards cannot be opened (`canEdit = !done`), the checkbox reopen always sends the task to `next` regardless of origin, and the Done column is unbounded. | [JI1][JI2] right-most is done; Jira ages out after 14 days (source number, not necessarily right for Stride) | Allow opening done cards (read/edit). Reopen restores the previous status if stored, else `next`. Show only tasks completed in the last 7 days (recommendation) with a "Show N older" row; add "Archive all done" to the Done column menu (undoable). |
| 5 | Medium | Every card is a tab stop (`tabIndex=0`), and every column scroller is also `tabIndex=0`. A board of 60 cards means 65+ tab stops. | [LI1] keyboard-first board; [HIG-SV] keyboard shortcuts | Roving tabindex: one tab stop for the board; arrow keys move focus between cards (Up/Down within column, Left/Right to the nearest card in the adjacent column), Alt+Arrow keeps moving. Add Linear-style `Alt+Shift+Up/Down` to send to top/bottom of column. [LI1] |
| 6 | Medium | No column collapse or hide. 5 columns at 288px + 12px gaps = 1488px of strip, which scrolls at any window narrower than about 1520px. Someday/Done are rarely used but always consume width. | [TR3] collapse keeps name + count; [LI1] hidden columns stay droppable | Add Collapse to the column menu. Collapsed column: 48px wide vertical strip with rotated title, count, and expand on click; still a drop target (highlight on hover). Persist per column in `stride:view:board:v1`. Add Hide with a "Hidden columns" entry in the toolbar that re-shows them. |
| 7 | Medium | Drag overlay is hard-coded `w-[272px]` but the real card width is 288 - 2x8 (column padding `p-2`) - 2x4 (scroller `px-1`) = 264px, so the card visibly grows 8px on pick-up. | Code read | Measure the active node (`active.rect.current.initial.width`) and apply it to the overlay, or set `w-[264px]` (compact: 288 - 12 - 8 = 268). Prefer measuring. |
| 8 | Medium | Drop line is positioned `-top-[5px]` / `-bottom-[5px]` with a `gap-2` (8px) between cards; the center of the gap is 4px away, so the line is 1px off-center and 3px thick. [AS1] specifies 2px and centered in the gap. | [AS1] | 2px height, offset `-top-1` / `-bottom-1` (4px) so it sits in the middle of the gap. Optionally add the 8px round terminal on the left. |
| 9 | Low | Empty state repeats the column name as a title ("Inbox", "Waiting") directly under a header that already says it. It is 100px+ tall dashed box. | Observation | Replace with a single muted line (13px) and no title; keep dashed border. Done: "Completed tasks land here". Drop-hover shows the accent tint (already does). |
| 10 | Low | Columns are `flex-none` 288px; the declared `min-w-[260px] max-w-[320px]` never applies. Wide windows leave dead space on the right. | Code read | On windows where 5 x 288 + gaps fits, let columns grow (`flex: 1 1 288px`, `max-w-[340px]`) so the board fills the width; below that, keep 288 fixed and scroll. Trello keeps fixed width (unverified how it behaves on wide screens), so this is a judgement call. |
| 11 | Low | Hover lift (`-translate-y-px`) combined with `cursor-grab` works, but there is no hover affordance beyond lift (no quick actions). | [TR4] hover shortcuts | Add the hover `...` button from gap 3. Add hover-only checkbox reveal? No: keep the checkbox always visible. |
| 12 | Low | No auto-scroll tuning evidence: `threshold {x: 0.12, y: 0.15}, acceleration: 12`. No source gives target values, so this is unverified either way. | [HIG-DD] says auto-scroll should exist | Keep. Test by dragging to the right edge on a 1280px window; check it scrolls without needing to leave the window. |
| 13 | Low | `title` on whole card is the task title (`aria-label`) which hides the chips from screen readers' summary. | a11y | Build `aria-label` as `"{title}, {project}, due {date}, {priority}"`. |

---

## (d) Recommended spec for the Stride board

Numbers marked (verified) come from a source above. Numbers marked (decision) are Stride choices, not copied facts.

### Layout

- Strip: horizontal scroll, `gap-3` (12px, decision), page padding 16px. Columns are `flex 0 0 288px` on narrow windows (decision; Trello's 272px wrapper in [TR5] is only an example container). Allow up to 340px growth when the window is wide (decision).
- Column surface: existing `bg-well`, `rounded-card` (14px), `shadow-soft-inset`, padding 8px (6px compact). Each column scrolls independently with the existing thin scrollbar.
- Visible partial column at the right edge when the strip overflows, to signal scrollability [HIG-SV]. Shift+wheel and trackpad scroll work (default).
- Order: Inbox, Next, Waiting, Someday, Done (as now). Not user-reorderable in v1 because columns are fixed GTD statuses.

### Column header (height 36px)

```
[o] Next  7                          [+] [...]
 ^dot ^title ^count(tabular)     add   menu
```

- Status dot 8px, title 13px semibold, count 12px muted tabular (existing).
- `+` 28x28 adds at the TOP of the column inline (composer opens at top). `...` 28x28 opens the column menu.
- Header stays fixed while cards scroll (already true).

### Card anatomy (width = column inner, 264px at 288 column)

```
+----------------------------------------+
| (o)  Write the Q4 plan for the         |  <- checkbox 20px hit area, 16px glyph
|      launch and share with team   [...]|  <- title 14px/20 semibold, max 3 lines;
|                                        |     [...] hover/focus only, 24x24
|  [High] [Nov 8] [* Launch] [@work] +1  |  <- chips 20px high, 11px, wrap, gap 6px
+----------------------------------------+
 padding 12px (10px compact), radius 14px, shadow-soft-sm, 8px gap between cards
```

- Content: title (3 lines), priority chip (if enabled), due chip (danger tone when overdue, with the word "overdue" in the accessible name), project chip with colour dot, up to 2 context/tag chips plus `+N`. No description, no cover, no avatars. Matches [LI1] "descriptions not shown".
- Checkbox on card: yes (Todoist/Asana-style completion circle; unverified for their exact UI; Stride rationale: single-user GTD completion is the most frequent action).
- Focus star on Next-pinned items (existing).
- Done cards: 80% opacity, title struck through and muted, still openable.

### Footer

- Full-width 32px ghost button "Add a card" (existing look). Click turns it into an inline composer (textarea, card surface, Enter creates, Shift+Enter newline, Escape cancels, stays open for chained entry, Add + Cancel buttons below) [TR2]. New cards get the column's status; in Next they get `isFocusedToday` false.
- Composer hidden when the column is collapsed.

### Drag and drop

- Whole card is the drag target (activation after 6px, existing). Original stays at 40% opacity (verified [AS1]).
- Overlay: width measured from the source card, `rotate-2` (Trello uses 4deg [AS1]; 2deg is the decision), raised shadow, max height clipped to 280px [AS1].
- Indicator: 2px line in the accent fill centered in the 8px gap, plus 8px terminal (verified [AS1]). Into an empty or collapsed column: tint the column background (`accent-soft`) with 350ms ease `cubic-bezier(0.15, 1, 0.3, 1)` (verified [AS1]), no line.
- Remove all feedback when the pointer leaves a valid target [HIG-DD]. Failed or cancelled drop: item springs back (already covered by dnd-kit `onDragCancel`).
- Auto-scroll horizontally and vertically while near edges (existing dnd-kit config) [HIG-DD].
- Undo: every drop is undoable with Cmd+Z (HIG "prefer letting people undo" [HIG-DD]). Check this is wired to the task store history before shipping.
- Sorted views: reorder disabled, cross-column still works, hint shown (existing) [GH1].

### Keyboard

- Tab enters the board once (roving tabindex). Arrow keys move focus between cards. Enter opens the task. Space starts keyboard drag (existing).
- Alt+Left/Right move across columns, Alt+Up/Down reorder (existing). Alt+Shift+Up/Down send to top/bottom (from [LI1]).
- `N` while a card is focused opens the composer in that column (Trello uses `n` for "below this card" [TR4]). `E` or Enter edits. `X` toggles done (Stride choice; Linear uses `X` to select [LI1], so avoid if multi-select is planned: then use Cmd+Return).
- `\` toggles collapse of the focused column (verified Trello shortcut [TR3]).
- Screen reader live region announcing moves (existing).

### Done handling

- Done is the right-most column and is visually quiet (muted dot).
- Show only recent completions (last 7 days, decision) with a "Show older (N)" row; column menu action "Archive all done" (undoable). Reference: Jira auto-removes done items after 14 days when no sprints [JI2].
- Reopen from checkbox returns to the previous status when known, else Next.

### Density

- Keep the existing two levels driven by `settings.appearance.density`: comfortable (12px card padding, 8px column padding) and compact (10px / 6px, chips 18px). Notion offers S/M/L [NO1]; two levels are enough for one user.

### Empty states

- One muted 13px line inside a dashed 56px-min drop zone, no title. Inbox: "Inbox zero. Capture something." Next: "Nothing next. Pull from Inbox or Someday." Waiting: "Nothing waiting on anyone." Someday: "Park ideas here." Done: "Finished tasks land here." The zone turns accent-tinted when a drag hovers it (existing behaviour).

### Column menu contents

1. Add a card at the top
2. Sort by > Manual, Due date, Priority, Title (changes the board sort; keeps the existing "ordering follows sort" hint)
3. Collapse column (`\`)
4. Hide column
5. Done only: Archive all done
6. Inbox only: Clear inbox... is NOT included (destructive); use Process inbox instead (opens the existing inbox processing flow).

### WIP limits: no

- Reason: the columns are GTD statuses, not a team flow; a single person gets no coordination benefit, and the sourced implementations are advisory or purely visual anyway (GitHub never blocks [GH1]; Jira only colors the header [JI1]; Linear and Notion have none [LI1][NO1]).
- If asked later, copy GitHub: per column, advisory, count turns warning-tone when exceeded, never blocks. Next is the only plausible candidate.

---

## (e) Deliberately not copied

| Item | Why not |
|---|---|
| Cover images, member avatars, stickers, attachments badges (Trello, Notion) | No assignees or attachments on a personal task; adds height and noise. [TR1][NO1] |
| Swimlanes / sub-groups (Linear, GitHub, Notion, Jira) | Project grouping is already a filter and a chip; a second axis multiplies scrolling on a laptop screen. Revisit after column collapse ships. |
| Enforced or colored WIP limits (Jira) | See WIP section. |
| Mid-list double-click to insert a card (Trello) | Poor discoverability on a trackpad; manual ordering by drag is enough. [TR2] |
| User-configurable card properties (Notion property visibility, GitHub fields) | Premature for v1. Stride already has the right fixed set. Revisit if requests appear. |
| Column reorder by dragging (Notion, Todoist) | Columns are fixed GTD statuses with semantics. [NO1][TD1] |
| Auto-removing done items after 14 days (Jira) | Hiding silently loses context for a personal tool; Stride shows "Show older" instead. [JI2] |
| Paid-only collapse (Trello) | Irrelevant to Stride; the feature is just good. [TR3] |
| Free-form per-list colors (Trello, Notion) | Stride's status dots already encode column identity under a single accent rule (see `stride-soft-ui.md`: "one accent... no coloured stripes"). |
| Trello 4deg rotation | Stride's soft UI prefers a smaller tilt (2deg), and reduced-motion disables it. [AS1] |
| Pixel values for Trello/Notion/Linear columns | Not published; not claimed as copied anywhere in this document. |

### Open items I could not verify

- Exact column width, gap, card padding, radius, shadow of Trello, Notion, Linear, GitHub, Jira, Asana, Todoist.
- Whether Notion has an add-card affordance at the column bottom (the help page does not cover it).
- Asana's current collapse and compact-card behaviour (official help page returned no body).
- NN/g, Smashing, and Atlassian kanban pagination/UX articles were not retrieved.
- Auto-scroll thresholds in any product.
