# Stride

A personal, AI-powered organiser for macOS (with iPhone/Android sync) that keeps you on top of what's urgent, what's coming, and what to do today.

Stride is a fork of [Stride](https://github.com/ishaanpilar/stride) by ishaanpilar, an open-source GTD app. All of Stride's foundations come with it: inbox, projects, contexts, calendar, Pomodoro focus, reminders, menu bar quick capture, an MCP server, and sync via iCloud, Dropbox, WebDAV or a self-hosted server. Stride adds an AI layer on top.

## What Stride adds

| Feature | Status |
| --- | --- |
| **DeepSeek preset**: one click in Settings → AI to set `https://api.deepseek.com`, with `deepseek-flash` by default and `deepseek-v4-pro` for planning | Done |
| **AI morning briefing**: a short daily plan (headline, top 5 tasks with reasons, today's schedule, what to Pomodoro first) as a notification and a card in Focus, falling back to the plain digest if the AI fails | Done |
| **Assistant chat**: type (or dictate with any system dictation tool) and the AI adds, updates, plans, breaks down and completes tasks through validated tools, asks before destructive or bulk changes, and logs every change with undo | In progress |
| **Menu bar panel**: next urgent items, one-click Pomodoro, quick "Ask…" | Planned |
| **Nightly self-organising pass**: triage the inbox, set priorities and due dates, archive done and stale tasks, with a reviewable change log | Planned |

New here? Read the [Stride User Guide](docs/STRIDE-GUIDE.md) for setup, daily use, shortcuts and how the repo is organised.

## Run it on your Mac

Prerequisites: [Bun](https://bun.sh) (the version in `.bun-version`), [Rust](https://rustup.rs) and Xcode.

```bash
bun install
bun run desktop:dev
```

Then open **Settings → AI**:

1. Turn AI on and choose the OpenAI provider.
2. Click **Use DeepSeek**.
3. Paste your DeepSeek API key.

## Working on Stride with an AI coding agent

[`CLAUDE.md`](CLAUDE.md) is the harness: the goals, rules and test gate any coding agent (Claude Code, OpenCode, Aider, DeepSeek-backed or not) follows when changing this repo.

## Staying in sync with Stride

`upstream` points at ishaanpilar/Stride. Pull improvements with `git fetch upstream && git merge upstream/main` on a branch, then run the gate in `CLAUDE.md`. Internal code names (`@stride/core`, the `stride` data folder) are left as-is on purpose so merges stay clean.

## Licence and credit

Stride is licensed under the [GNU AGPL-3.0](LICENSE), the same as Stride. Copyright for the original code belongs to the Stride authors; see the [upstream project](https://github.com/ishaanpilar/stride) for their full README, docs and contributors.
