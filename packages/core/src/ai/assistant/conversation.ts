import type { ChangeEntry, PendingConfirmation } from './types';
import type { HistoryMessage } from './agent';
import { toLocalDay as localDayKey } from './dates';

// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const ASSISTANT_THREAD_KEY_PREFIX = 'mindwtr:assistant:thread:';
export const MAX_STORED_MESSAGES = 200;

export interface ThreadMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    createdAt: string;
    isError?: boolean;
    /** Change entries / pending confirmations caused by this (user) message's turn are keyed by messageId. */
    turnId?: string;
}

export interface AssistantThread {
    day: string;
    messages: ThreadMessage[];
    changes: ChangeEntry[];
    pending: PendingConfirmation[];
}

export interface ThreadStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem?(key: string): void;
}

export const threadKey = (day: string) => `${ASSISTANT_THREAD_KEY_PREFIX}${day}`;
export const emptyThread = (day: string): AssistantThread => ({ day, messages: [], changes: [], pending: [] });

export function loadThread(storage: ThreadStorage | null | undefined, now: Date = new Date()): AssistantThread {
    const day = localDayKey(now);
    try {
        const raw = storage?.getItem(threadKey(day));
        if (!raw) return emptyThread(day);
        const parsed = JSON.parse(raw) as Partial<AssistantThread>;
        if (!parsed || parsed.day !== day || !Array.isArray(parsed.messages)) return emptyThread(day);
        return {
            day,
            messages: parsed.messages.filter((m) => m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant')),
            changes: Array.isArray(parsed.changes) ? parsed.changes : [],
            pending: Array.isArray(parsed.pending) ? parsed.pending : [],
        };
    } catch {
        return emptyThread(day);
    }
}

export function saveThread(storage: ThreadStorage | null | undefined, thread: AssistantThread): void {
    try {
        const messages = thread.messages.slice(-MAX_STORED_MESSAGES);
        const turnIds = new Set(messages.map((m) => m.turnId).filter(Boolean));
        storage?.setItem(threadKey(thread.day), JSON.stringify({
            ...thread,
            messages,
            changes: thread.changes.filter((c) => turnIds.has(c.messageId)),
            pending: thread.pending.filter((p) => turnIds.has(p.messageId)),
        }));
    } catch {
        // persistence is best-effort
    }
}

/** "New chat": drop today's thread. */
export function clearThread(storage: ThreadStorage | null | undefined, now: Date = new Date()): AssistantThread {
    const day = localDayKey(now);
    try { storage?.removeItem?.(threadKey(day)); } catch { /* ignore */ }
    return emptyThread(day);
}

/** Model-facing history: plain text only, with a compact note of what each turn changed (short ids). */
export function toModelHistory(thread: AssistantThread): HistoryMessage[] {
    return thread.messages.filter((m) => !m.isError).map((m) => {
        if (m.role === 'assistant' && m.turnId) {
            const labels = thread.changes.filter((c) => c.messageId === m.turnId && !c.undone)
                .flatMap((c) => c.changes.map((x) => `${x.taskId.slice(0, 8)}`).slice(0, 5).map((id) => `${c.label} [${id}]`));
            if (labels.length) return { role: 'assistant' as const, content: `${m.text}\n[Actions: ${labels.slice(0, 8).join('; ')}]` };
        }
        return { role: m.role, content: m.text };
    });
}
