import {
    appendFocusCoachFeedback,
    generateUUID,
    minutesToTimeEstimate,
    parseFocusCoachFeedbackLog,
    summarizeFocusCoachFeedback,
    useTaskStore,
    type FocusCoachAction,
    type FocusCoachFeedbackEntry,
    type Task,
} from '@stride/core';
import { getWorkspaceCache } from './workspace-cache';

export const FOCUS_COACH_FEEDBACK_STORAGE_KEY = 'stride:focus:coach-feedback:v1';
export const FOCUS_NOW_STORAGE_KEY = 'stride:focus:now:v1';

export function readFocusCoachFeedback(): FocusCoachFeedbackEntry[] {
    try {
        const raw = getWorkspaceCache()?.getItem(FOCUS_COACH_FEEDBACK_STORAGE_KEY);
        return raw ? parseFocusCoachFeedbackLog(JSON.parse(raw)) : [];
    } catch {
        return [];
    }
}

export function recordFocusCoachFeedback(entry: FocusCoachFeedbackEntry): FocusCoachFeedbackEntry[] {
    const next = appendFocusCoachFeedback(readFocusCoachFeedback(), entry);
    try {
        getWorkspaceCache()?.setItem(FOCUS_COACH_FEEDBACK_STORAGE_KEY, JSON.stringify(next));
    } catch {
        return next;
    }
    return next;
}

export const readFocusCoachFeedbackSummary = (): string[] => summarizeFocusCoachFeedback(readFocusCoachFeedback());

export function writeFocusNow(taskId: string | undefined, text: string | null): void {
    try {
        const cache = getWorkspaceCache();
        if (!cache) return;
        if (taskId && text) cache.setItem(FOCUS_NOW_STORAGE_KEY, JSON.stringify({ taskId, text: text.slice(0, 140) }));
        else cache.removeItem(FOCUS_NOW_STORAGE_KEY);
    } catch {
        return;
    }
}

export function readFocusNow(taskId: string | undefined): string | null {
    if (!taskId) return null;
    try {
        const raw = getWorkspaceCache()?.getItem(FOCUS_NOW_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object') {
            const { taskId: id, text } = parsed as Record<string, unknown>;
            if (id === taskId && typeof text === 'string' && text.trim()) return text.trim().slice(0, 140);
        }
    } catch {
        return null;
    }
    return null;
}

export interface FocusUndo {
    undo: () => Promise<boolean>;
}

const readTask = (taskId: string): Task | undefined => useTaskStore.getState()._allTasks.find((t) => t.id === taskId);

async function patchWithUndo(taskId: string, patch: Partial<Task>): Promise<FocusUndo | null> {
    const before = readTask(taskId);
    if (!before) return null;
    const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, before[key as keyof Task]])) as Partial<Task>;
    const result = await useTaskStore.getState().updateTask(taskId, patch);
    if (result?.success === false) return null;
    return {
        undo: async () => (await useTaskStore.getState().updateTask(taskId, previous))?.success !== false,
    };
}

export const toLocalStartTime = (date: string, time?: string) => (time ? `${date}T${time}:00` : date);

export async function applyFocusCoachAction(taskId: string, action: FocusCoachAction): Promise<FocusUndo | null> {
    const task = readTask(taskId);
    if (!task) return null;
    if (action.type === 'set_time_estimate') return patchWithUndo(taskId, { timeEstimate: minutesToTimeEstimate(action.minutes) });
    if (action.type === 'schedule') return patchWithUndo(taskId, { startTime: toLocalStartTime(action.date, action.time) });
    if (action.type === 'set_waiting_for') {
        const patch: Partial<Task> = { status: 'waiting', isFocusedToday: false };
        if (action.person) patch.assignedTo = action.person;
        if (action.note) patch.description = [task.description?.trim(), action.note].filter(Boolean).join('\n\n');
        return patchWithUndo(taskId, patch);
    }
    const initial: Partial<Task> = { status: 'next' };
    if (task.projectId) initial.projectId = task.projectId;
    if (task.areaId) initial.areaId = task.areaId;
    const result = await useTaskStore.getState().addTask(action.title, initial);
    if (result?.success === false || !result?.id) return null;
    const id = result.id;
    return { undo: async () => (await useTaskStore.getState().deleteTask(id))?.success !== false };
}

export const markFocusTaskDone = (taskId: string) => patchWithUndo(taskId, { status: 'done', isFocusedToday: false });

export async function addFocusChecklistItems(taskId: string, titles: readonly string[]): Promise<FocusUndo | null> {
    const task = readTask(taskId);
    if (!task || titles.length === 0) return null;
    const items = titles.map((title) => ({ id: generateUUID(), title: title.slice(0, 200), isCompleted: false }));
    const ids = new Set(items.map((i) => i.id));
    const result = await useTaskStore.getState().updateTask(taskId, { checklist: [...(task.checklist ?? []), ...items] });
    if (result?.success === false) return null;
    return {
        undo: async () => {
            const live = readTask(taskId);
            if (!live) return false;
            const res = await useTaskStore.getState().updateTask(taskId, { checklist: (live.checklist ?? []).filter((i) => !ids.has(i.id)) });
            return res?.success !== false;
        },
    };
}
