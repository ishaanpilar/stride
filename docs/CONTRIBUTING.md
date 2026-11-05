# Contributing to Stride

Thanks for your interest in improving Stride. This guide covers:

- Before you begin
- Code contribution process
- Development setup and workflow
- Testing and quality checks
- Pull request guidelines
- Documentation and translation contributions

Stride is a Bun monorepo. The Mac app is the focus right now; the mobile app is not yet rebuilt as Stride.

- Desktop app (`apps/desktop`): Tauri + React + Vite
- Mobile app (`apps/mobile`): Expo + React Native
- Shared core package (`packages/core`): state models, storage adapters, and shared logic


## Before you begin

### 1) Follow our community standards

- Read and follow the [Code of Conduct](https://github.com/ishaanpilar/stride/blob/main/.github/CODE_OF_CONDUCT.md).
- Be respectful in issues, discussions, reviews, and commits.

### 2) Report security issues privately

- Do not open public issues for security vulnerabilities.
- Use [SECURITY.md](https://github.com/ishaanpilar/stride/blob/main/SECURITY.md) for responsible disclosure instructions.

### 3) Start with an issue for non-trivial changes

For behavior changes, significant bug fixes, or new features, open (or confirm) an issue first.
This helps avoid duplicated work and keeps changes aligned with project goals.

When opening an issue, include:

- Platform and version (`desktop`, `mobile`, or both)
- Reproduction steps and expected behavior
- Actual behavior
- Screenshots, screen recordings, and logs when relevant

### 4) Keep product fit in mind

Stride focuses on GTD and practical execution, and is built to be **simple by default and powerful when you need it**: progressive disclosure, less by default, no feature creep. *Don't show me a cockpit when I just want to ride a bike.* Contributions are most likely to be accepted when they:

- Keep workflows simple by default
- Avoid unnecessary UI complexity
- Prefer automatic over manual: if the right outcome can be inferred (platform, install channel, existing data, context), the app should just do it — no new setting, no prompt, no extra workflow step or UI control — and reuse an existing switch before minting a new one (for example, update checks adapt to the install channel instead of offering a toggle)
- Preserve data safety and reliability
- Work consistently across platforms when applicable

## Code contribution process

1. Find an issue to work on, or open one for discussion.
2. Fork the repository and create a branch in your fork.
3. Implement the change with focused scope.
4. Run relevant checks locally.
5. Open a pull request to `ishaanpilar/stride:main`.
6. Link the issue in the PR (example: `Fixes #123`).

Branch naming examples:

- `fix/tray-preference-persistence`
- `feature/date-format-setting`
- `docs/contributing-update`

## Development setup and workflow

Run all commands from the repository root.

### Prerequisites

- Bun (workspace/package manager) — use the version in `.bun-version` (currently 1.3.5) or newer
- Node.js 20 or newer — `apps/mcp-server` declares `"node": ">=20"` and is published to npm, so it must build and run on plain Node
- Python 3 — `bun run verify` runs the governance tests, which include `scripts/ci/google-play-edit.test.py`
- PowerShell 7 (`pwsh`), optional — the governance tests in `bun run verify` run script blocks from the Windows release workflows through it (`scripts/ci/msstore-rollout.test.js`, `scripts/ci/publish-msstore-flight.test.js`). Without it those tests are skipped with a notice; CI always runs them
- Git
- Rust toolchain (required for Tauri desktop build/dev)
- System webview dependencies for Tauri on your OS
- On Windows: the Visual Studio 2022 C++ build tools. The 2026 toolchain currently fails to link the `whisper-rs` transcription bindings (LNK1120 unresolved C-runtime externals), so pin the MSVC v143 toolset until that is fixed upstream.
- Expo tooling for mobile development
- Android SDK and/or Xcode if building mobile natively

### Install dependencies

```bash
bun install
```

### Run the apps

Desktop (Tauri):

```bash
bun desktop:dev
```

Desktop UI only (browser/Vite):

```bash
bun desktop:web
```

Mobile (Expo):

```bash
bun mobile:start
```

Mobile on device/emulator:

```bash
bun mobile:android
bun mobile:ios
```

### Useful structure reference

- `apps/desktop/src`: desktop UI and desktop integrations
- `apps/mobile`: mobile UI and native bridge code
- `packages/core/src`: shared business logic, store, sync, and utilities
- `scripts/`: release and utility scripts
- `docs/`: markdown docs used by the project

Desktop code must not import `invoke` from `@tauri-apps/api/core` directly. Call
`invokeNative` (rejects when there is no Tauri runtime) or `invokeNativeOr(fallback, ...)`
(resolves to the fallback) from `apps/desktop/src/lib/tauri-invoke.ts`, so each call site
states what it should do in the browser dev build. A ratchet test in
`tauri-invoke.test.ts` fails CI on a raw import.

## Testing and quality checks

Before pushing, run the baseline local verification gate:

```bash
bun run verify
```

`bun run verify` chains typecheck (core, cloud, desktop, mobile, and mcp), lint
for every workspace app, the five workspace unit-test suites, the Rust suite
(`native:test`, a few seconds once the cargo cache is warm), the governance
checks, and schema checks. The governance checks (`bun run governance`, which is
`scripts/ci/governance.sh`) are the same script the CI governance job runs:
locale parity, README parity, store and workflow metadata, and the release
script tests. Add a new governance check to that script, not to the workflow.
A check whose tool is not installed locally is skipped with a message; in CI a
missing tool fails. CI also runs performance budgets, coverage thresholds, and
Expo Doctor.

Run `bun run native:test` on its own while iterating on
`apps/desktop/src-tauri/`, and run
`bun run test:perf` for list, store, recurrence, or other hot-path changes.
`bun run test:e2e` needs a browser and remains a separate optional gate.

While iterating, the per-area commands below are faster.

Desktop lint:

```bash
bun run --filter stride lint
```

Desktop tests (single pass, non-watch):

```bash
bun run --filter stride test -- --run
```

Core tests:

```bash
bun run --filter @stride/core test
```

Mobile tests:

```bash
bun run --filter mobile test
```

Optional e2e:

```bash
bun run test:e2e
```

## Coding conventions

- TypeScript first.
- Prefer functional React components and hooks.
- Keep imports grouped: external, workspace/internal, then relative.
- Match file-local formatting conventions:
  - desktop/core usually 4 spaces
  - mobile usually 2 spaces
- Keep code comments concise and only where logic is non-obvious.
- Favor accessibility-oriented test queries (`getByRole`, `getByLabelText`).
- Mobile popups: any transparent-modal popup that contains a `TextInput` must use the shared `useAndroidKeyboardInset` hook so it stays above the Android soft keyboard.
- Markdown editor changes need regression tests for the historical failure modes (cursor jump on tap, scroll-into-view, keyboard-height padding, toolbar timing) — these have each shipped as production bugs before.

Naming:

- Components/providers: `PascalCase`
- Hooks: `useSomething`
- Utility modules: kebab-case (example: `storage-adapter.ts`)
- Tests: mirror source filename with `.test.ts`/`.test.tsx`

## Building with AI agents

Stride is built with AI coding agents, and we are glad when you build with them too. Most of Stride's own code was written by Claude through Claude Code, directed and reviewed by a human. Agents are first-class contributors here; the bar is the same for every change, however it was written.

How to work with an agent on Stride:

1. Start from [`CLAUDE.md`](../CLAUDE.md). It is the harness every agent follows: the goals, the rules and the test gate. Point your agent at it before it writes anything.
2. Use a coding agent with the whole repository in context (Claude Code, Codex, OpenCode, Aider and similar), not a chat window you paste code out of.
3. Give it a clear goal: the bug or feature, the expected behaviour, and how you will check it.
4. Run several agents in parallel if it helps, but give each one its own files so they don't overwrite each other, and review each one's work.
5. Keep the gate green: typecheck, lint, translations (`bun run i18n:check`, never `--fix`), Rust tests when `src-tauri` changes, and the unit tests for what you touched.
6. Check the result in the real app, not only in tests, and say in the PR what you could not verify.
7. You own what you submit. Read every change before asking for review, and cut filler from code, comments and PR text.
8. Credit the agent. Add a `Co-Authored-By:` line for the model that helped, so the history stays honest.

Rules for AI features inside the app (also in `CLAUDE.md`): AI output is untrusted, so validate it, time it out and always keep a non-AI fallback; destructive AI actions need confirmation or undo; never log or commit API keys; tests mock AI providers and never call a real API.

## Pull request guidelines

All submissions go through GitHub pull requests and maintainer review.

Please keep PRs small and focused:

- One bug fix, one feature, or one isolated refactor per PR
- Avoid bundling unrelated changes

Before opening a PR:

- Ensure relevant checks pass locally
- Rebase/merge your branch as needed to resolve conflicts
- Verify no unrelated files are included

In your PR description, include:

- What changed
- Why it changed
- Linked issue (`Fixes #...`)
- Test evidence (commands run and outcomes)
- Screenshots/recordings for UI changes
- Platform impact (`desktop`, `mobile`, `core`, or combinations)

Commit style:

- Use Conventional Commits when possible
- Examples:
  - `fix(desktop): persist tray preference on macOS`
  - `feat(core): add date format normalization`
  - `docs: clarify sync troubleshooting`

## Documentation contributions

Documentation updates are welcome in `README.md`, `README_zh.md` and the docs in `docs/`.

User-facing documentation goes in `docs/` (for example `docs/STRIDE-GUIDE.md`), alongside contribution guides, architecture summaries, ADRs, and release notes. The `wiki/` directory holds only a landing page that points to `docs/`; do not add content pages there.

When changing docs:

- Keep instructions accurate and runnable
- Prefer concrete examples over vague guidance
- Validate links
- Update both English and Chinese docs when the content is mirrored
- Keep `README.md` and `README_zh.md` heading structure aligned; CI runs `bun run docs:check-readme`

Useful references:

- [User guide](STRIDE-GUIDE.md)
- [Visual design spec](design/stride-soft-ui.md)
- [Agent harness](../CLAUDE.md)

## Translation contributions

Most translation strings live in:

- [`packages/core/src/i18n/locales/`](https://github.com/ishaanpilar/stride/tree/main/packages/core/src/i18n/locales/)

When updating translations:

- Keep placeholders and interpolation keys unchanged
- Keep command tokens intact where parser behavior depends on English commands
- For a new language, register the locale in the shared i18n registries, date locale mapping, desktop/mobile language pickers, and locale parity checks
- After changing any `starter.*` string, run `bun run scripts/i18n-locale-parity.ts --fix` to regenerate `packages/core/src/i18n/starter-seed-strings.ts`. That file is generated, never hand-edited, and `bun run i18n:check` fails until it is back in sync
- Run `bun run i18n:check` and relevant core i18n tests
- Confirm UI still fits in small mobile layouts

## Need help?

If you are unsure about scope or implementation details:

- Open a GitHub issue with a short proposal
- Ask for maintainer feedback before implementing large changes

Thanks again for contributing to Stride.
