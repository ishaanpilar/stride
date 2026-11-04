import type { Task } from '../../types';
import { dayKeyOf, toLocalDateTime, toLocalDay } from './dates';
import type { AssistantStorePort } from './types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Compact workspace summary: ids are shortened and only names/counts are included. */
export function buildWorkspaceSummary(port: AssistantStorePort, now: Date): string {
    const { tasks, projects, areas } = port.getSnapshot();
    const live = tasks.filter((t) => !t.deletedAt && !t.purgedAt);
    const open = live.filter((t) => t.status !== 'done' && t.status !== 'archived' && t.status !== 'reference');
    const today = toLocalDay(now);
    const overdue = open.filter((t) => { const d = dayKeyOf(t.dueDate); return !!d && d < today; }).length;
    const contexts = new Map<string, number>();
    for (const t of open as Task[]) for (const c of t.contexts ?? []) contexts.set(c, (contexts.get(c) ?? 0) + 1);
    const topContexts = [...contexts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([c]) => c);
    const activeProjects = projects.filter((p) => !p.deletedAt && p.status === 'active').slice(0, 30);
    return [
        `Open tasks: ${open.length} (inbox ${live.filter((t) => t.status === 'inbox').length}, overdue ${overdue}).`,
        areas.length ? `Areas: ${areas.filter((a) => !a.deletedAt).slice(0, 15).map((a) => `${a.name} (${a.id.slice(0, 8)})`).join(', ')}.` : '',
        activeProjects.length ? `Active projects: ${activeProjects.map((p) => `${p.title} (${p.id.slice(0, 8)})`).join('; ')}.` : 'No active projects.',
        topContexts.length ? `Contexts: ${topContexts.join(', ')}.` : '',
    ].filter(Boolean).join('\n');
}

export function buildSystemPrompt(port: AssistantStorePort, now: Date, timeZone?: string): string {
    return [
        'You are the Stride Assistant, a GTD task assistant inside a desktop app. You act on the user\'s tasks ONLY by calling tools.',
        `Current local date/time: ${toLocalDateTime(now)} (${WEEKDAYS[now.getDay()]})${timeZone ? `, timezone ${timeZone}` : ''}.`,
        '',
        'Workspace:',
        buildWorkspaceSummary(port, now),
        '',
        'Rules:',
        '- Resolve relative dates ("Friday", "next week", "by the 20th") against the current date above. Pass dates as local "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (24h). Never pass past dates for new deadlines.',
        '- If a request is ambiguous (missing time for a reminder, several tasks match, unclear scope), ask ONE short clarifying question instead of guessing. Do not call mutating tools until it is clear.',
        '- Never invent task ids. Find tasks with list_tasks first and use the ids it returns.',
        '- Prefer few, precise tool calls. Batch related changes (move_tasks) rather than many single calls.',
        '- delete_task and bulk changes touching more than 3 tasks need user confirmation: the tool will say it is awaiting confirmation. Do not retry or work around it; tell the user to confirm.',
        '- If a tool returns an error, fix the arguments and retry once; otherwise explain the problem briefly.',
        '- For planning requests ("plan it out"), create a project with add_project and sensible next actions with due dates before the deadline.',
        '- For "break down X", call breakdown_task with concrete steps you write.',
        '- Questions ("what is urgent today?") are answered from get_today_overview / list_tasks; do not change anything.',
        '- Final reply: 1-3 short sentences saying what you did or found. No markdown tables, no restating every field.',
    ].join('\n');
}
