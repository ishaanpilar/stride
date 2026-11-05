# Focus timer research: start, during, finish

Why this exists: three attempts at the Stride timer were rejected as "a circle with numbers", disconnected
from the focus screen, without reward, and in the wrong style. This note looks at how the best focus and
flow apps handle the three moments that matter (start, running, finish), and says what to copy and what to
avoid. The prototypes in `docs/design/focus-timer/` apply it.

## What the best apps do

| App | Start | While running | Finish / reward | Takeaway |
| --- | --- | --- | --- | --- |
| **Forest** | Plant a seed for a set time | A tree grows; leaving the app withers it | The tree joins a forest that grows over days; coins unlock species | A **living metaphor** with a **persistent collection** makes every session feel like it adds up. Loss (withering) works on phones but is punitive on a desktop work app. |
| **Session** (Mac) | You state an **intention**, then a short breath before committing | Minimal timer; intention shown in widget and blockers | A short **reflection** ("how did it go?") | Naming the one thing up front and a calm ritual make starting feel deliberate. |
| **Flow** (Mac) | One click from the menu bar | Menu bar countdown; no dock icon | Notification sound | Minimal and fast, but users complain the menu bar countdown is distracting. Offer a quieter status item. |
| **Sunsama** focus mode | Press F on a task, or starting the task timer opens focus mode | One task, its subtasks and a timer; Esc to exit | Completing the task moves to the next one | The **task is the session**. Users say a long subtask list is distracting while executing: show the current step, not everything. |
| **Llama Life** | Each task has its own timer | Countdown per task | **Confetti and chimes** on completion | Small celebrations make a to-do list fun. Works because it is brief and earned. |
| **Focusmate** | Say hello and state what you will do | A partner is present | A one-line check-in on what you got done | The "social ending" gives work a close instead of letting it dissolve. One sentence is enough. |
| **Opal** | Start a session (can be locked) | Blocking | Gems that grow brighter and more intricate; milestones; a streak flame | Rewards framed as **positive reinforcement, never punishment**; the collectible evolves over time. |
| **Centered** | Set priorities | Flow music and a coach that nudges you | Focused time and tasks completed | Gentle coaching during the session; reviewers single out the nudges as the best part. |
| **Tide / Endel** | One tap | Nature sound or generative audio with **slow, organic visuals** ("never jarring") | Gentle sound | Ambient, slowly changing visuals feel calm and premium without needing any numbers. |
| **Apple Activity rings / Timer** | n/a | Glanceable progress | Rings close with a **celebratory sparkle** and haptic | Celebrate the moment of closure; keep everything else quiet. |
| **Things 3** | n/a | n/a | The checkbox fill, check and a soft sound are a **reward, not just feedback** | Micro-interactions on ticking matter as much as the big finish. |
| **Raycast Focus** | Goal, duration, blocked apps in one form | A floating Focus Bar, or a discreet menu bar item | Complete Focus Session | Keep a small, dismissible surface; let people move it to the menu bar. |
| **Headspace** (motion) | n/a | Slow, gentle, predictable motion; soft blurs; small deltas | n/a | Calm comes from long ease-in-out curves and small movements, not from bounce. |

## What to copy

1. **The task is the session.** Starting focus means starting a task, not starting a timer. The picked task
   physically becomes the focus screen (shared-element transition) and returns to the list when you finish.
   This fixes the "timer and focus screen are separate things" complaint. (Sunsama, Session's intention.)
2. **A deliberate start moment.** One clear action, then a short choreographed transition: the rest of the
   app blurs and desaturates, the task rises to centre, the time arrives. Under a second, no modal dialogs.
3. **Show the current step, not the whole plan.** AI-generated steps are shown with the current one
   emphasised; the rest are quiet. A tip for the current step is a gentle coach (Centered).
4. **Progress you feel, not read.** Replace the ring with something ambient: a light that shifts colour over
   the session (Endel/Tide), a plant that grows (Forest), or the task card filling as steps complete. Keep
   the exact time available but secondary.
5. **Reward ticking a step.** A Things-style check (fill, draw, small ripple) plus a visible effect elsewhere
   (light pulse, a petal opening, the card filling) and a one-line encouragement.
6. **A real finish.** A single calm sentence, one strong action ("Mark as done" or "Take a break"), and a
   short celebration proportional to the achievement: confetti only when the whole task is done. (Llama
   Life, Apple rings, Focusmate's one-line close.)
7. **A collection that accumulates.** Today's sessions as a small visible record (a garden, a count) so the
   next session feels like adding to something. Framed positively, never as a broken streak. (Forest, Opal.)
8. **Minimal menu bar.** One status item with the least useful information that still answers "how am I
   doing" (time or step count), and a 380px panel with just the time, task, current step, and pause.

## What to avoid

- A ring plus big monospace numbers as the main event: it reads as a kitchen timer, not as work getting done.
- A separate timer card and a separate focus modal: two places for one thing.
- Punishment mechanics (withering, losing streaks) in a work app; they create anxiety.
- Long lists of subtasks while executing (Sunsama users report this exact problem).
- Confetti or fanfare for every small action; save the big celebration for finishing the task.
- Bouncy or fast motion during the session. Use long ease-in-out; spring only on taps.
- Sound by default. Offer a soft chime, off by default (WebAudio in the prototypes).
- Hard-to-find controls. Keep pause on Space and exit on Esc, with visible buttons that fade when idle.

## Sources

- Forest: [forestapp.cc](https://forestapp.cc), [App Store](https://apps.apple.com/app/866450515)
- Session: [Getting started guide](https://stayinsession.com/learn/getting-started-with-session-pomodoro-app), [Why I love Session](https://myproductivemac.com/blog/why-i-love-session1282021)
- Flow: [App Store](https://apps.apple.com/us/app/flow-focus-and-work-timer/id1423210932?l=en&mt=12), [Product Hunt reviews](https://producthunt.com/products/flow-app/reviews)
- Sunsama: [Focus mode help](https://help.sunsama.com/docs/focus-mode), [Focus bar](https://help.sunsama.com/docs/focus-bar), [roadmap feedback](https://roadmap.sunsama.com/improvements/p/fokus-im-fokus)
- Llama Life: [App Store](https://apps.apple.com/us/app/adhd-organizer-llama-life/id6454469750)
- Focusmate: [What happens during a session](https://support.focusmate.com/en/articles/4044432-what-happens-during-a-focusmate-session-do-s-don-ts)
- Opal: [Streaks and focus hours](https://opalapp.com/help/what-are-streaks-and-focus-hours), [The milestone reveal moment](https://opalapp.com/blog/the-milestone-reveal-moment)
- Centered: [Product Hunt](https://www.producthunt.com/p/centered/centered-2)
- Tide: [Tide Lite](https://apps.apple.com/us/app/-/id1342124199)
- Endel: [Design critique](https://ixd.prattsi.org/2026/02/design-critique-endel-ios-app/)
- Apple rings: [Android Authority on ten years of rings](https://androidauthority.com/apple-rings-ten-year-anniversary-3547546)
- Things 3: [Design study](https://blakecrosley.com/blog/design-study-things)
- Raycast Focus: [Manual](https://manual.raycast.com/focus)
- Calm motion: [Val Head, Designing more expressive products](https://noti.st/valhead/7BLVVM/slides)
