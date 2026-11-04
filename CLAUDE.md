# Stride: agent harness

Stride is a personal, AI-powered organiser for the Mac, published at https://github.com/ishaanpilar/stride (AGPL-3.0).
Any coding agent (Claude Code, OpenCode, Aider, DeepSeek-backed or not) must follow this file.

## Goals and roadmap
Done so far:
- AI provider choice: DeepSeek (OpenAI-compatible, `https://api.deepseek.com`) and Claude.
- AI morning briefing (Focus card and notification).
- Assistant chat (Cmd+Shift+J) with a tool-calling harness, confirmations for destructive/bulk changes, and undo.
- AI Quick Capture (Cmd/Ctrl+Shift+K): dump everything, AI proposes projects/tasks, review, add, one undo.
- macOS menu bar panel (Today/Upcoming/Inbox/Next, capture-first input, AI Capture, Pomodoro, Ask the Assistant, today's calendar events).

Next:
- A real Mac app build (signed, installable, iCloud sync).
- Meetings next to tasks.
- Time-blocking tasks onto the calendar.
- Nightly tidy-up: triage inbox, set priorities and due dates, archive done/stale, with a change log you can undo.
- An iPhone app (the Expo and native iOS/Android apps in this repo are not yet rebuilt as Stride).

## Environment
- Bun version is pinned in `.bun-version`. Run `bun install` at the repo root.
- Rust comes from Homebrew rustup. Put it on PATH with `export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"`.
- Desktop app: `bun run desktop:dev` (Tauri v2). Web-only UI: `bun run desktop:web`.

## The gate (a change is done only when these pass)
Fast loop while working:
- `bun test <path>` for the files you touched (core: `packages/core/src/...`).
- `bun run typecheck:core && bun run typecheck:desktop`.
Before declaring a feature done:
- `bun run typecheck && bun run lint:all && bun run test`.
- `bun run native:test` if Rust in `apps/desktop/src-tauri` changed.
- `bun run schema:check` if synced fields changed. Read `docs/development/native-mobile-parity.md` before changing settings or synced data that native iOS/Android hosts mirror.

## Rules
- Shared logic goes in `packages/core`. UI goes in `apps/desktop/src` (and `apps/mobile` when shared).
- AI calls go through the existing provider abstraction in `packages/core/src/ai/`. Never add a second HTTP client.
- Every AI output is untrusted. Validate the JSON, drop unknown task IDs, time out, and fall back to non-AI behaviour.
- Destructive AI actions (delete, bulk move, archive) need explicit user confirmation, or must be undoable and logged.
- Never log, commit or hard-code API keys. Use the app's existing key storage.
- Tests mock AI providers. Never call a real AI API from tests.
- Follow `docs/development/code-style.md`.
