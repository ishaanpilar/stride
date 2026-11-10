# Stride User Guide

As of 4 Nov 2026 · Ishaan Pilar

## Stride at a glance

Stride is your personal organiser for macOS: a local-first GTD app with an AI layer on top. Everything is stored on your Mac and the app works fully offline. Internet is needed only for the AI features and for sync.

| Part | What it does | Where you find it |
| --- | --- | --- |
| Tasks, projects, contexts | The GTD system: capture everything, decide the next action, review weekly | Sidebar |
| Assistant chat | Type or dictate a request and the AI adds, moves, plans, breaks down and completes tasks | The panel button at the right of the toolbar, or Cmd+Shift+J |
| AI morning briefing | A daily plan: headline, top 5 tasks with reasons, today's schedule, what to Pomodoro first | Card at the top of Focus, plus a morning notification |
| AI Quick Capture | Dump everything you have on your mind; the AI proposes projects and tasks, you review, then add | Cmd/Ctrl+Shift+K, or AI Capture in the menu bar panel |
| Menu bar panel | Today, Upcoming, Inbox and Next at a glance, with capture, Pomodoro and the Assistant | Click the Stride icon in the menu bar |
| DeepSeek / Claude | The AI that powers these features, using your own API key | Settings → AI |
| Pomodoro | Focus/break timer linked to a task | Focus view, once turned on |
| Reminders and digest | Due-date notifications, morning briefing, evening review prompt | Settings → Notifications |

The daily loop is: **capture → process the inbox → plan the day in Focus → work in Pomodoros → weekly review.**

## First-time setup

Do these once. Total time: about 5 minutes.

1. **Start the app.** Open Terminal and run:

    ```bash
    export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
    cd <your Stride repo folder> && bun run desktop:dev
    ```

    The Stride window opens in about 10 seconds. Leave the Terminal window open. Closing it, or quitting the app, stops Stride.
2. **Turn on AI.** Go to Settings (Cmd+,) → AI. Switch on **Enable AI assistant** and click **Agree** on the consent dialog.
3. **Pick a provider.**
    - **DeepSeek** (cheapest): choose **DeepSeek** in Provider. The model `deepseek-flash` is filled in for you. Type `deepseek-v4-pro` in Model if you want deeper planning.
    - **Claude**: choose **Anthropic (Claude)**. Use `claude-sonnet-5-5` for everyday use, `claude-opus-5-5` for the most capable, or `claude-haiku-5-5` for the cheapest.
4. **Paste your API key** into the API key field. Keys are stored on this Mac only and never synced. Get one from [platform.deepseek.com](https://platform.deepseek.com) or [console.anthropic.com](https://console.anthropic.com).
5. **Turn on the morning briefing.** Settings → Notifications: switch on the daily digest, then **AI morning briefing**.
6. **Turn on Pomodoro** (optional). Go to Settings → GTD and switch on **Pomodoro timer**.
7. **Check it works.** Press **Cmd+Shift+J** and type "what's urgent today?". You should get a reply within a few seconds.

## How everything is organised

Stride follows Getting Things Done (GTD). Every task has one **status**, and each status has its own view.

| Building block | What it is | Example |
| --- | --- | --- |
| Inbox | Everything you capture, before you decide what it is | "call Raj about invoice" |
| Next Actions | Concrete things you can do now | "Email Raj the March invoice" |
| Projects | Any outcome that needs more than one step; holds its tasks | "Launch website" |
| Areas | Big life/work buckets that group projects | Work, Personal, Health |
| Contexts (@) | Where or with what you can do a task | @computer, @phone, @errands |
| Tags (#) | Free labels | #finance, #deep-work |
| Waiting For | Things someone else owes you | "Designer sending logo" |
| Someday/Maybe | Ideas you're not committing to now | "Learn Spanish" |
| Reference | Information to keep, not do | Wi-Fi password, account numbers |

The sidebar groups the views like this:

- **At the top, always shown**: Focus (today's plan, briefing card, Pomodoro), Inbox, Projects, Calendar, Review (weekly review wizard).
- **Lists** (click to fold or unfold): Next Actions, Waiting For, Someday/Maybe.
- **More** (click to fold or unfold): Reference, Obsidian (once a vault is connected), Board (kanban), Timeline (start-to-due bars, optional), Contexts, History (Done and Archived), Trash (deleted tasks can be restored until they're purged).

To drop a task on a list in a folded group, drag it over the group's name first and the group opens.

## Your daily workflow

1. **Capture anything, any time.** Press **Control+Option+M** from any app to quick-add to the Inbox. Inside Stride, press **a**. You can also tell the Assistant "add …".
2. **Use quick-add shortcuts while typing.** For example, `Pay rent /due:fri @computer #finance +Home` sets the due date, context, tag and project in one line. More syntax is in the shortcuts section.
3. **Process the Inbox** (once a day). For each item, do it if it takes under 2 minutes. Otherwise make it a Next Action, put it in a project, move it to Waiting For or Someday, or delete it. The Inbox's guided clarify flow walks you through this.
4. **Plan the day in Focus.** Read the morning briefing card at the top. Press **S** on any task to add it to today's focus.
5. **Work in Pomodoros.** Start the timer in Focus, linked to the task you're doing. Mark it done when finished.
6. **Weekly review** (about 30 min on a fixed day). Open Review and follow the steps. Its AI step suggests what to do with stale tasks.

## Using the AI

### Assistant chat

Open it with **Cmd+Shift+J** or the panel button at the right of the toolbar. Type, or dictate with Wispr Flow: the text box accepts any dictation. Enter sends and Shift+Enter adds a new line.

Things you can ask:

- "Add dentist Friday 5pm and remind me"
- "What's urgent today?"
- "I need to launch the website by the 20th, plan it out"
- "Break down 'prepare tax return' into steps"
- "Move everything non-urgent to next week"
- "Mark the invoice task done"

How it keeps you safe:

- **Changes show as chips** under the reply, for example "Added 'Dentist' · Fri 6 Nov, 17:00". Each chip has **Undo**, and **Undo all** reverses everything from that message.
- **It asks first** before deleting anything, or before any change touching more than 3 tasks. Nothing happens until you click Confirm.
- **It asks when unsure.** If a request is unclear, it asks a question instead of guessing.
- **New chat** starts a fresh conversation. Each day has its own thread.

It works with DeepSeek, OpenAI and Claude. It doesn't work with Gemini yet.

### AI Quick Capture

Press **Cmd/Ctrl+Shift+K** (or choose AI Capture in the menu bar panel), then type or dictate everything on your mind in one go. The AI proposes projects and tasks. Review the proposal, edit or remove anything you don't want, then add. One **Undo** reverses the whole batch. The AI's output is validated before anything is shown, and nothing is added until you confirm.

### AI morning briefing

Each morning the briefing appears as a notification and as a card at the top of Focus. It shows a headline (for example "3 urgent, 2 meetings, 1 overdue"), your top 5 tasks with a reason and a time estimate, today's schedule, and one suggestion of what to Pomodoro first. Press **Regenerate** on the card to make a fresh one. If the AI fails or times out, you get the normal digest instead. Only task titles, dates, priorities, projects and contexts are sent to the AI, never notes or attachments.

### Built-in AI helpers

- **Clarify**: open a task, click the sparkle button, choose Clarify to turn a vague task into a clear next action.
- **Break down**: same menu, splits a task into steps.
- **Suggestions**: while typing a task, an AI suggestion for context, time estimate and tags appears below it. Click to apply.
- **Review**: the AI step in the weekly review suggests actions for stale tasks.

## Focus and Pomodoro

The Pomodoro panel lives in the **Focus** view once it's turned on (Settings → GTD → Pomodoro timer). Pick a preset or set custom focus/break minutes there. Turn on **Link timer to task** to choose which task you're timing and mark it done from the timer. You can also auto-start breaks.

Notifications are set in Settings → Notifications:

- **Due-date reminders**: alerts when a task is due, or at its reminder time.
- **Morning briefing**: the AI briefing when AI is on, otherwise the plain digest.
- **Evening review prompt**: a nudge to close out the day.

## The menu bar panel

Click the Stride icon in the macOS menu bar (left or right click) to open the panel. It has four tabs: **Today**, **Upcoming**, **Inbox** and **Next**. The input at the top is capture-first: type and press Enter to add to the Inbox. The panel also has **AI Capture**, a Pomodoro control, **Ask the Assistant**, and today's calendar events.

**Open Stride**, **Lock** and **Quit** live in the panel itself, not in a separate right-click menu.

## Using it on your phone

The phone apps in this repo (Expo, native iOS and native Android) are not yet rebuilt as Stride, and there is no Stride build for the App Store or Google Play. Treat phone support as not available for now. As a stopgap, you can sync your data through **Dropbox** or **WebDAV** (Settings → Sync) and test with a couple of tasks before relying on it. Open question: which phone build, if any, is safe to point at a Stride data file today.

Because Stride currently runs as an unsigned developer build, **iCloud sync won't work**. The **Assistant chat, AI Quick Capture and the AI briefing are desktop-only** for now.

## Keyboard shortcuts

Press **?** (or **Ctrl+H**) inside Stride to see the full list for your keybinding style. You can switch between Vim, Emacs and Standard styles in Settings.

| Action | Keys |
| --- | --- |
| Quick add from any app | Control+Option+M |
| Quick add inside Stride | a |
| Open the Assistant | Cmd+Shift+J |
| Settings | Cmd+, |
| Search | / (Vim) or Ctrl+S (Standard) |
| Toggle sidebar | Cmd+B |
| Toggle focus mode | Cmd+Shift+\ |
| Sync now | Cmd+Option+S |
| Undo last complete/delete | Cmd+Z |
| Add task to today's focus | S |
| Go to Inbox / Next / Focus / Projects | gi / gn / gf / gp (Vim) or Alt+I / Alt+N / Alt+A / Alt+P (Standard) |
| Set status: Inbox / Next / Waiting / Someday / Done | si / sn / sw / ss / sd |

Quick-add syntax: `/due:<when>`, `/start:<when>`, `/note:<text>`, `/link:<url>`, `/next`, `/waiting`, `/someday`, `/*` (add to today's focus), `@context`, `#tag`, `+Project`, `!Area`, `%Person`.

## How the code is organised

The app lives in your local clone of the repo. It is a monorepo: one repo with several apps sharing one core.

| Folder | What's in it |
| --- | --- |
| `apps/desktop/src` | The Mac app's screens (React + TypeScript) |
| `apps/desktop/src-tauri` | The Mac app's native shell (Rust): tray icon, notifications, storage |
| `packages/core` | Shared logic for every app: task store, sync, AI providers |
| `packages/core/src/ai/assistant` | The Assistant harness: tools, agent loop, confirmations, undo, DeepSeek and Claude clients |
| `packages/core/src/ai/daily-briefing.ts` | The AI morning briefing logic |
| `apps/mobile`, `apps/ios-native`, `apps/android-native` | Phone apps carried over from the original codebase (not yet rebuilt as Stride) |
| `apps/mcp-server` | Lets outside AI tools (Claude Code, etc.) read and edit your tasks |
| `apps/cloud` | Self-hostable sync server |
| `CLAUDE.md` | The harness rules any coding agent follows when changing Stride |
| `docs/` | Documentation, including this guide |

Git setup:

- **`origin`**: [github.com/ishaanpilar/stride](https://github.com/ishaanpilar/stride) (public). Open question: the current local branch and how it maps to `main` (the rename work is on `stride-rename`).
- **Data**: your tasks live in `~/Library/Application Support/stride`, outside the repo, so they never get pushed.

## Running and publishing

Run all commands from the repo folder. Put Rust on the PATH first:

```bash
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
cd <your Stride repo folder>
```

| Task | Command |
| --- | --- |
| Start the app | `bun run desktop:dev` |
| Stop the app | Quit from the menu bar icon, or Ctrl+C in Terminal |
| Run the AI tests | `cd packages/core && bunx vitest run src/ai` |
| Typecheck | `bun run typecheck:core && bun run typecheck:desktop` |
| Push your changes to GitHub | `git push origin <branch>` (open question: confirm the branch you publish from) |

You can ask Claude Code, working in this folder, to do any of these. It reads `CLAUDE.md` first.

## Known limits and troubleshooting

| Problem | What to do |
| --- | --- |
| The app window closed | Stride stops when you quit it. Run `bun run desktop:dev` again. |
| Assistant says "provider not supported" | Gemini isn't supported. Switch to DeepSeek, OpenAI or Claude in Settings → AI. |
| Assistant says the key is missing | Paste the key again in Settings → AI. DeepSeek and OpenAI share the OpenAI key slot. |
| "Rejected the request" or 401 error | The key is wrong, or the model ID is mistyped. |
| No morning briefing | Check that the daily digest and AI morning briefing are both on in Settings → Notifications. |
| Widget warning in Terminal | Harmless. Home-screen widgets need a signed build. |
| iCloud sync doesn't work | Expected with the dev build. Use Dropbox or WebDAV. |

Not built yet: a nightly self-organising pass, meetings next to tasks, time-blocking to the calendar, a signed Mac build (for iCloud sync and widgets), Gemini in the chat, and a Stride phone app.

## Credits

Stride is based on Mindwtr by dongdongbh (https://github.com/dongdongbh/Mindwtr) and is licensed under the AGPL-3.0.
