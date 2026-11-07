import type { AIProvider } from './ai/types';
import {
    appendFocusCoachFeedback,
    generateFocusCoach,
    generateFocusCoachReply,
    parseFocusCoachFeedbackLog,
    summarizeFocusCoachFeedback,
    type FocusCoach,
    type FocusCoachAction,
    type FocusCoachFeedbackEntry,
    type FocusCoachInput,
    type FocusCoachReply,
    type FocusCoachTurn,
    type FocusTranslate,
} from './ai/focus-coach-ai';
import { generateFocusEncouragement, type FocusEncouragementInput } from './ai/focus-encouragement-ai';
import { minutesToTimeEstimate } from './calendar-scheduling';
import type { Language } from './i18n';
import { useTaskStore } from './store';
import type { Task } from './types';
import { undoTaskCompletion } from './undo-task-completion';
import { generateUUID } from './uuid';

export const FOCUS_COACH_FEEDBACK_STORAGE_KEY = 'stride:focus:coach-feedback:v1';
export const FOCUS_NOW_STORAGE_KEY = 'stride:focus:now:v1';
const FOCUS_NOW_MAX_CHARS = 140;

export interface FocusKeyValueStorage {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
}

export type FocusProviderResolver = (language: Language, timeoutMs: number) => Promise<Pick<AIProvider, 'generateText'> | null>;

export interface FocusUndo {
    undo: () => Promise<boolean>;
}

export function createFocusAiService(resolveProvider: FocusProviderResolver) {
    const coachCache = new Map<string, FocusCoach>();
    const encouragementCache = new Map<string, string>();

    const safeProvider = async (language: Language, timeoutMs: number) => {
        try {
            return await resolveProvider(language, timeoutMs);
        } catch {
            return null;
        }
    };

    return {
        async requestFocusCoach(
            cacheKey: string,
            input: FocusCoachInput,
            options: { language?: Language; tr?: FocusTranslate; seed?: number } = {},
        ): Promise<FocusCoach> {
            const cached = coachCache.get(cacheKey);
            if (cached) return cached;
            const provider = await safeProvider(options.language ?? 'en', 8_000);
            const coach = await generateFocusCoach(provider, input, { tr: options.tr, seed: options.seed });
            if (coach.source === 'ai') coachCache.set(cacheKey, coach);
            return coach;
        },
        async requestFocusCoachReply(
            input: FocusCoachInput,
            turns: readonly FocusCoachTurn[],
            options: { language?: Language; tr?: FocusTranslate; now?: Date } = {},
        ): Promise<FocusCoachReply> {
            const provider = await safeProvider(options.language ?? 'en', 6_000);
            return generateFocusCoachReply(provider, input, turns, { now: options.now ?? new Date(), tr: options.tr });
        },
        async requestFocusEncouragement(
            cacheKey: string,
            input: FocusEncouragementInput,
            language: Language = 'en',
        ): Promise<string | null> {
            const cached = encouragementCache.get(cacheKey);
            if (cached) return cached;
            const provider = await safeProvider(language, 6_000);
            if (!provider) return null;
            try {
                const line = await generateFocusEncouragement(provider, input);
                if (line) encouragementCache.set(cacheKey, line);
                return line;
            } catch {
                return null;
            }
        },
        resetCaches() {
            coachCache.clear();
            encouragementCache.clear();
        },
    };
}

export type FocusAiService = ReturnType<typeof createFocusAiService>;

export function createFocusCoachStore(getStorage: () => FocusKeyValueStorage | null) {
    const readFeedback = (): FocusCoachFeedbackEntry[] => {
        try {
            const raw = getStorage()?.getItem(FOCUS_COACH_FEEDBACK_STORAGE_KEY);
            return raw ? parseFocusCoachFeedbackLog(JSON.parse(raw)) : [];
        } catch {
            return [];
        }
    };

    return {
        readFocusCoachFeedback: readFeedback,
        recordFocusCoachFeedback(entry: FocusCoachFeedbackEntry): FocusCoachFeedbackEntry[] {
            const next = appendFocusCoachFeedback(readFeedback(), entry);
            try {
                getStorage()?.setItem(FOCUS_COACH_FEEDBACK_STORAGE_KEY, JSON.stringify(next));
            } catch {
                return next;
            }
            return next;
        },
        readFocusCoachFeedbackSummary: (): string[] => summarizeFocusCoachFeedback(readFeedback()),
        writeFocusNow(taskId: string | undefined, text: string | null): void {
            try {
                const storage = getStorage();
                if (!storage) return;
                if (taskId && text) storage.setItem(FOCUS_NOW_STORAGE_KEY, JSON.stringify({ taskId, text: text.slice(0, FOCUS_NOW_MAX_CHARS) }));
                else storage.removeItem(FOCUS_NOW_STORAGE_KEY);
            } catch {
                return;
            }
        },
        readFocusNow(taskId: string | undefined): string | null {
            if (!taskId) return null;
            try {
                const raw = getStorage()?.getItem(FOCUS_NOW_STORAGE_KEY);
                const parsed: unknown = raw ? JSON.parse(raw) : null;
                if (parsed && typeof parsed === 'object') {
                    const { taskId: id, text } = parsed as Record<string, unknown>;
                    if (id === taskId && typeof text === 'string' && text.trim()) return text.trim().slice(0, FOCUS_NOW_MAX_CHARS);
                }
            } catch {
                return null;
            }
            return null;
        },
    };
}

export type FocusCoachStore = ReturnType<typeof createFocusCoachStore>;

export const readFocusTask = (taskId: string): Task | undefined => useTaskStore.getState()._allTasks.find((t) => t.id === taskId);

async function patchWithUndo(taskId: string, patch: Partial<Task>): Promise<FocusUndo | null> {
    const before = readFocusTask(taskId);
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
    const task = readFocusTask(taskId);
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

/** Undo goes through undoTaskCompletion: a repeating task must not keep the occurrence this created. */
export async function markFocusTaskDone(taskId: string): Promise<FocusUndo | null> {
    const before = readFocusTask(taskId);
    if (!before) return null;
    const previousStatus = before.status;
    const wasFocusedToday = before.isFocusedToday === true;
    const result = await useTaskStore.getState().updateTask(taskId, { status: 'done', isFocusedToday: false });
    if (result?.success === false) return null;
    return {
        undo: () => undoTaskCompletion(taskId, previousStatus, wasFocusedToday).then(() => true, () => false),
    };
}

export interface FocusChecklistAdd extends FocusUndo {
    /** Ids of the checklist items that were added. */
    ids: string[];
}

export async function addFocusChecklistItems(taskId: string, titles: readonly string[]): Promise<FocusChecklistAdd | null> {
    const task = readFocusTask(taskId);
    if (!task || titles.length === 0) return null;
    const items = titles.map((title) => ({ id: generateUUID(), title: title.slice(0, 200), isCompleted: false }));
    const ids = new Set(items.map((i) => i.id));
    const result = await useTaskStore.getState().updateTask(taskId, { checklist: [...(task.checklist ?? []), ...items] });
    if (result?.success === false) return null;
    return {
        ids: items.map((i) => i.id),
        undo: async () => {
            const live = readFocusTask(taskId);
            if (!live) return false;
            const res = await useTaskStore.getState().updateTask(taskId, { checklist: (live.checklist ?? []).filter((i) => !ids.has(i.id)) });
            return res?.success !== false;
        },
    };
}

/**
 * "Update steps" from the coach: the open steps it added earlier (`replaceIds`) give way to the new
 * ones; steps the user ticked or wrote stay. New titles already on the checklist are skipped. Undo
 * puts the checklist back exactly as it was.
 */
export async function replaceFocusChecklistItems(
    taskId: string,
    titles: readonly string[],
    replaceIds: readonly string[] = [],
): Promise<FocusChecklistAdd | null> {
    const task = readFocusTask(taskId);
    if (!task || titles.length === 0) return null;
    const previous = task.checklist ?? [];
    const drop = new Set(replaceIds);
    const kept = previous.filter((item) => item.isCompleted || !drop.has(item.id));
    const have = new Set(kept.map((item) => item.title.trim().toLowerCase()));
    const items = titles
        .filter((title) => !have.has(title.trim().toLowerCase()))
        .map((title) => ({ id: generateUUID(), title: title.slice(0, 200), isCompleted: false }));
    if (items.length === 0 && kept.length === previous.length) return null;
    const result = await useTaskStore.getState().updateTask(taskId, { checklist: [...kept, ...items] });
    if (result?.success === false) return null;
    return {
        ids: items.map((i) => i.id),
        undo: async () => (await useTaskStore.getState().updateTask(taskId, { checklist: previous }))?.success !== false,
    };
}
