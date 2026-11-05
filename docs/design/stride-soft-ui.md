# Stride UI: Soft UI Evolution, macOS-native

This is the visual spec for the Stride desktop (macOS) redesign. Every agent changing the UI follows it.
Reference mockup: `docs/design/reference-next-actions.png` (the screen to match). Earlier exploration:
`docs/design/stride-ui-direction.html`.

Scope: **visual design only.** Keep existing layout logic, content, behaviour, data flow, keyboard
shortcuts, ARIA roles and test IDs. macOS is the only target right now; Windows/Linux must still render
(fallbacks), but don't spend effort polishing them.

## The style in one paragraph

Soft UI Evolution: the soft, calm surfaces of neumorphism with real contrast. A cool, very light
background; content sits on white surfaces with soft dual shadows (light top-left, cool grey
bottom-right); grouped or secondary content sits in gently inset wells. One accent, the **macOS system
accent colour**, appears as a gradient on primary buttons, as a soft tint on the selected item, and on
the progress bar. Everything else is quiet: system font, generous spacing, rounded corners, no
coloured stripes, no boxed outlines.

## Accent: follow macOS

- The accent is the user's macOS accent (System Settings > Appearance > Accent colour), read natively
  (`NSColor.controlAccentColor`) and pushed to CSS variables; re-read when the app gains focus and on
  `NSSystemColorsDidChangeNotification`. Fallback when unavailable (dev web, non-macOS): `#4F46E5`.
- Exposed as CSS variables: `--accent` (H S L channels, like the other tokens), `--accent-strong`
  (darkened until white text on it is >= 4.5:1), `--accent-gradient-from`, `--accent-gradient-to`
  (from = accent-strong, to = the same hue shifted about +25 degrees and slightly lighter, also
  >= 4.5:1 with the label colour), `--accent-foreground` (white, or ink `#1F2937` when the accent is
  so light that white cannot reach 4.5:1, for example yellow), `--accent-soft` (selection and pill tint:
  accent at ~12% over the surface in light mode, ~20% in dark), `--accent-text` (accent darkened or
  lightened until >= 4.5:1 on the surface, for text and icons).
- Map the existing `--primary`, `--ring` and `--primary-foreground` tokens onto these, so the
  hundreds of existing `bg-primary`, `text-primary` and `ring-primary` usages pick up the system accent
  automatically.

## Tokens (light)

| Token | Value | Use |
| --- | --- | --- |
| background | `#F0F4F8` | window content background |
| sidebar | `#EEF1F7` at 80% over the macOS sidebar material | sidebar |
| surface / card | `#FFFFFF` | task rows, panels, inputs, popovers |
| well | `#E9EEF4` with inset soft shadow | grouped/secondary content, segmented control track, progress track |
| shadow-light | `#FFFFFF` | top-left half of dual shadow |
| shadow-dark | `#D1D9E6` | bottom-right half of dual shadow |
| foreground | `#1F2937` | text (14.7:1 on #F0F4F8) |
| muted-foreground | `#4B5563` | secondary text (7.0:1 on white, 6.4:1 on #F0F4F8) |
| tertiary | `#6B7280` | placeholders, disabled (4.8:1 on white) |
| border | `rgba(209, 217, 230, 0.6)` | hairlines, only where a shadow can't do the job |
| success fill / text | `#22C55E` / `#15803D` | fills, rings and bars / text |
| warning fill / text | `#EA580C` / `#C2410C` | fills / text |
| danger fill / text | `#EF4444` / `#B91C1C` | overdue, Urgent, High; pills use danger at 10% fill with danger text |

## Tokens (dark)

Dark is its own palette, not an inversion. Shadows become a subtle top highlight plus a deeper drop.

| Token | Value |
| --- | --- |
| background | `#14161C` |
| sidebar | `#1A1D24` at 80% over the material |
| surface | `#1E222A` |
| well | `#171A20` (inset: `inset 2px 2px 6px rgba(0,0,0,.45), inset -1px -1px 2px rgba(255,255,255,.04)`) |
| raised shadow | `0 1px 0 rgba(255,255,255,.05) inset, 0 6px 18px rgba(0,0,0,.35)` |
| foreground | `#F3F4F6` (15.6:1 on surface) |
| muted-foreground | `#A1A8B5` (7.1:1 on surface) |
| tertiary | `#8A92A0` |
| border | `rgba(255,255,255,.08)` |
| success / warning / danger text | `#4ADE80` / `#FB923C` / `#F87171` |

## Effects

- **Raised surface** (`.soft-surface`, Tailwind `shadow-soft`): `-6px -6px 15px var(--shadow-light), 6px 6px 15px var(--shadow-dark)` for
  big panels; rows use a smaller `-3px -3px 8px, 3px 3px 8px` version (`shadow-soft-sm`).
- **Well** (`.soft-well`, `shadow-soft-inset`): `inset -4px -4px 10px var(--shadow-light), inset 4px 4px 10px var(--shadow-dark)`.
  Nest at most one level (surface > well).
- **Primary button** (`.btn-gradient`): `linear-gradient(135deg, var(--accent-gradient-from), var(--accent-gradient-to))`,
  label `--accent-foreground`, semibold 13px, radius 10px, height 32px (toolbar) / 36px (dialogs),
  shadow `0 4px 14px hsl(var(--accent) / .35)`. Hover: lift 1px and brighten 4%. Active: inset, no lift.
- **Secondary button / icon button**: surface fill, `shadow-soft-sm`, 1px border at the border token,
  radius 10px, 32x32 minimum for icon buttons (every icon-only button has an `aria-label`).
- **Selection** (sidebar item, selected row): `--accent-soft` fill, radius 10px; selected sidebar label
  semibold; no outline, no left bar.
- **Focus**: always visible: `outline: 2px solid hsl(var(--accent)); outline-offset: 2px` (inside
  dense lists offset 0 and inset ring). Never remove focus styles.
- **Motion**: 200-250ms ease-out on shadow, background and transform only. Under
  `prefers-reduced-motion: reduce`, no transforms or transitions.
- **Completing a task** (one shared sequence, `lib/completion-sequence.ts`, ~1.3s): the checkbox pops
  (0.85 -> 1.15 -> 1) and fills with success, the check draws, a soft success ripple; the strike-through
  draws left to right while the title and chips fade to muted and the card flashes a success tint; the
  row holds, done, for a beat (Undo is in the toast); then it collapses and the rows below rise, and
  views that keep done tasks show it at the bottom as a flat, receded card. Animations off or reduced
  motion: instant. Optional quiet tick (Settings > Sounds > Completion sound).
- **Increase contrast** (`prefers-contrast: more`): borders become solid `#9AA5B8` (light) /
  `#5B6475` (dark), shadows drop, muted text uses foreground.
- **Reduce transparency**: the sidebar uses its opaque token instead of material.

## Type (system font, macOS scale)

| Role | Size / line | Weight |
| --- | --- | --- |
| View title | 30 / 36 | Bold, tracking -0.02em |
| Count beside title | 15 / 20 | Regular, muted |
| Task title | 15 / 20 | Semibold |
| Body, controls, sidebar items | 14 / 18 | Regular (selected: Semibold) |
| Notes, meta, counts | 13 / 17 | Regular, muted |
| Chips, sidebar group titles | 12 / 16 | Medium (group titles semibold, sentence case, muted) |

Minimum on screen: 11px. No all-caps tiny letter-spaced labels; group titles are sentence case
("Plan", "Do", "Organise").

## Layout and components (match the mockup)

- **Window**: overlay title bar (traffic lights inside the sidebar, no title text), sidebar about
  260px, content area on `background`.
- **Sidebar**: app mark (rounded square, gradient) + "Stride" at 20px bold; a full-width soft
  **Capture** button (surface, `+` icon, label, `⌘K` hint right); groups "Plan" (Today, Calendar),
  "Do" (Inbox, Next Actions, Waiting, Someday), "Organise" (Projects, ...); 36px rows with outline
  icon, label and count right-aligned (muted, tabular numbers); selected row = accent-soft pill. A soft
  accent glow (radial gradient of `--accent` at ~15%) at the bottom-left of the sidebar.
- **Toolbar** (top of content, no divider line): back/forward pair as one soft segmented control; a
  wide search field in a well with a magnifier and the `⌘F` hint; then right-aligned icon buttons
  (filter, more) and the gradient **Capture ⌘K** button.
- **View header**: title + count on one baseline; below it "Today: X of Y done" left and
  "N left · about H h M m" right in muted 14px; a 6px rounded progress bar (well track, accent gradient
  fill) under that.
- **Task row**: white surface card, radius 14px, `shadow-soft-sm`, 16px padding, 10px gap between
  rows. Leading 22px circle checkbox (1.5px tertiary stroke; hover shows accent; done = success fill
  with check). Title 15 semibold; optional note line muted 14; chips row: project chip (dot in project
  colour + name, well fill), date chip (calendar icon + "Today"/"Sat, 8 Nov"; today = accent-soft fill +
  accent-text; overdue = danger 10% fill + danger text + the word "overdue"). Priority pill at the
  trailing top (High/Urgent: danger 10% fill + danger text; Medium: warning; Low: muted). Selected row
  = accent-soft fill with a 1px accent hairline. No coloured left stripes.
- **Chips/pills**: height 26px, radius 999px, 12-13px text, icon 14px.
- **Inputs**: surface or well fill, radius 10px, no heavy borders, accent focus ring.
- **Dialogs/sheets/popovers**: surface, radius 16px, `shadow-soft`, title 17 semibold, primary
  action = gradient button on the trailing side, Cancel secondary.

## Accessibility floor (checked before any merge)

- Text contrast >= 4.5:1 (>= 3:1 for 18px+ or 14px+ bold). Bright fills (#22C55E, #EA580C, accent)
  are for fills, rings and bars, never body text.
- Visible keyboard focus everywhere; icon-only controls have `aria-label`.
- `prefers-reduced-motion`, `prefers-contrast: more` and dark mode handled.
- Nothing conveyed by colour alone (overdue says "overdue", priority says its name).

## Foundation layer (built; use these, don't re-invent)

Tokens are `H S% L%` channels used as `hsl(var(--x))`, except the full values noted.

- Tailwind colours: `bg-well`, `bg-sidebar`, `text-tertiary`, `bg-accent-soft` (full colour, no `/50`
  opacity suffix), `text-accent-text`, `accent-fill` (raw system accent), `accent-strong`, `on-accent`
  (label colour on strong fills), `danger` / `danger-text`, `success-fill` / `success-text`,
  `warning-fill` / `warning-text`. `primary` / `ring` follow the system accent.
- **Careful:** Tailwind `accent` / `accent-foreground` (`bg-accent`, `hover:bg-accent`) are still the
  NEUTRAL hover fill (backed by `--accent-ui`). The system accent is `accent-fill` / `accent-soft` /
  `accent-text` / `primary`.
- Shadows: `shadow-soft`, `shadow-soft-sm`, `shadow-soft-inset`. Gradient: `bg-accent-gradient`.
  Radii: `rounded-control` (10px), `rounded-card` (14px), `rounded-sheet` (16px), `rounded-pill`.
- Component classes: `.soft-surface`, `.soft-well`, `.btn-gradient`, `.soft-pill`, `.focus-ring`,
  `.focus-ring-inset`; `.metadata-badge` is pill-shaped.
- Window chrome: macOS main window has an overlay title bar (traffic lights over content).
  `html.macos-overlay-titlebar` sets `--titlebar-inset: 28px`; pad the sidebar top with
  `var(--titlebar-inset)`. Add `data-tauri-drag-region` to the sidebar header and toolbar so the
  window can be dragged (only on non-interactive areas).
- Primitives in `apps/desktop/src/components/ui/`:
  - `Button` (variants primary = gradient, secondary, ghost, outline, destructive, destructive-ghost, icon)
  - `IconButton` (`aria-label` required; `variant` soft|ghost; `size` md 32px | sm 28px)
  - `Surface` (`as`, `size` sm|lg, `selected`), `Well` (`as`)
  - `Pill` / `Chip` (`tone` neutral|accent|danger|warning|success; `dot` true or CSS colour; `icon`)
  - `ProgressBar` (`value`, `max`, `valueText`, `aria-label`)
  - `ViewHeader` (`title`, `count`, `actions`, `titleId`, `progress: {leftText, rightText, value, max, label}`; renders an h1)
  - `SearchField` (input props + `shortcutHint`, `wrapperClassName`)
  - `SegmentedControl` (`options[{value,label,icon,ariaLabel,disabled}]`, `value`, `onChange`, `aria-label`, `size`)
- Inputs aren't globally restyled: use `bg-well rounded-control focus-ring` (or `SearchField`).
