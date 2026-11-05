<div align="center">

<img src="branding/source/stride-icon-source.png" width="120" alt="Stride icon">

# Stride

**A calm, AI-powered organiser for the Mac.**

Capture everything, let the AI file and plan it, then focus on one thing at a time.
Built on David Allen's *Getting Things Done*. Your data stays on your Mac.

[Download](https://github.com/ishaanpilar/stride/releases/latest) · [Features](#features) · [Built with AI](#built-with-ai) · [User guide](docs/STRIDE-GUIDE.md)

</div>

## Features

### An assistant that does the filing

- **Assistant chat** (⌘⇧J, docked on the right): ask in plain language and it adds, updates, schedules, merges and cleans up tasks, projects, areas and tags through validated tools. Replies come in a short, scannable format with suggestion chips and one clear question when it needs a decision.
- **Undo for everything**: every AI change lands in a Changes card with its own Undo. Destructive or bulk changes ask first, and a clean-up plan ("rename 2, archive 3, merge 1") is one approval and one Undo.
- **AI Capture** (⌘⇧K): dump everything on your mind; the AI proposes projects and tasks, you review, then add them in one go.
- **Morning briefing**: a short plan for the day as a notification and a card in Focus.
- **Area context**: describe each area (a company, a part of life) with what belongs there, keywords and people, or just tell the Assistant ("Build me an area for Frackly Works: a 3D printing company…"). Capture, the Assistant and the focus coach use it to file work in the right place, say why, ask when unsure, and learn from your corrections.

### Focus mode

- Start a Pomodoro from the Today card, the menu bar, or by right-clicking any task.
- The rest of the app fades away and the task takes the stage, with a large calm timer and a slowly shifting glow.
- A focus coach estimates how long the task really takes, suggests the next real action (or that you delegate it), motivates you and asks one useful question. It only suggests steps when your notes or related tasks back them up, and every suggestion has Useful / Not useful / Doesn't make sense.
- When the timer ends it asks "Is it done?" and helps you finish, reschedule or hand it off.
- Minimise to a floating mini timer, hide it to a small pill, or go full screen.

### Everything GTD needs

- Inbox, Next Actions, Waiting For, Someday/Maybe, Projects, Areas, Contexts, Reference and a weekly review.
- Today/Focus view, a Trello-style board, calendar and timeline.
- Drag to reorder anywhere; drag onto the sidebar or calendar to move or schedule.
- Done tasks strike through and sink to the bottom.

### Made for the Mac

- Soft, native design that follows your macOS accent colour, in light and dark.
- Smooth animations throughout, with an on/off switch (and it respects Reduce motion).
- Menu bar panel: capture, Today, Inbox, Next, Upcoming, reorder, Pomodoro, resizable.
- One-way sync of dated tasks to a "Stride" calendar in macOS Calendar (works with Google Calendar accounts).
- Imports from Todoist, TickTick and OmniFocus. An MCP server lets Claude and other AI clients work with your tasks.

### Your keys, your data

- Bring your own AI key: DeepSeek or Claude. Keys live in the macOS keychain.
- Local-first: your tasks are stored on your Mac, with optional sync (iCloud, Dropbox, WebDAV or a self-hosted server).
- No telemetry.

## Install

1. Download `Stride.app.zip` from the [latest release](https://github.com/ishaanpilar/stride/releases/latest) and move **Stride** to Applications.
2. The current builds are not notarised by Apple yet. The first time, right-click Stride and choose **Open**, or allow it in **System Settings → Privacy & Security**.
3. Open **Settings → AI**, choose DeepSeek or Claude and paste your API key. Stride works without AI too.

## Build from source

Prerequisites: [Bun](https://bun.sh) (version in `.bun-version`), [Rust](https://rustup.rs) and Xcode.

```bash
bun install
bun run desktop:dev        # run the Mac app
bun run desktop:web        # UI only, in the browser
```

## Built with AI

Stride is built with AI coding agents, openly and on purpose. Most of its code since the fork was written by Claude working through Claude Code, directed and reviewed by a human who decides what ships. We think this is a good way to build software when it is done with care:

- [`CLAUDE.md`](CLAUDE.md) is the harness every coding agent follows: the goals, the rules and the test gate.
- Agents must keep the gate green: typecheck, lint, translations, Rust and unit tests.
- AI output inside the app is treated as untrusted: it is validated, time-limited and always has a non-AI fallback.

AI-assisted contributions are welcome. See [CONTRIBUTING](docs/CONTRIBUTING.md).

## Roadmap

- Meetings next to tasks
- Time-blocking tasks onto the calendar, with two-way sync
- A daily plan and shutdown ritual
- Nightly AI tidy-up with an undo log
- iPhone app

## Licence and credit

Stride is free software under the [GNU AGPL-3.0](LICENSE).

Stride started as a fork of [Mindwtr](https://github.com/dongdongbh/Mindwtr) by dongdongbh and its contributors, an open-source GTD app. Its foundations (data model, sync, calendar, imports, MCP server and much more) come from Mindwtr, and copyright in that code belongs to the Mindwtr authors. See [NOTICE](NOTICE).

Stride is inspired by David Allen's *Getting Things Done*. It is not affiliated with or endorsed by David Allen or the David Allen Company.
