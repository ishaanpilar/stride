import { create } from 'zustand';
import {
    AssistantChangeLog,
    clearThread,
    executeConfirmed,
    generateUUID,
    loadThread,
    runAssistantTurn,
    saveThread,
    toModelHistory,
    type AssistantThread,
    type ThreadMessage,
} from '@stride/core';
import type { Language } from '@stride/core';
import { createAssistantClient, createStoreAssistantPort } from '../lib/assistant-service';

const storage = () => {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

const timeZone = () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
};

let changeLog = new AssistantChangeLog();
let inFlight: AbortController | null = null;

interface AssistantState {
    thread: AssistantThread;
    busy: boolean;
    /** Bumps whenever the change log mutates so views re-render. */
    logVersion: number;
    hydrate: () => void;
    send: (text: string, language?: Language) => Promise<void>;
    stop: () => void;
    confirm: (pendingId: string) => Promise<void>;
    reject: (pendingId: string) => void;
    undoEntry: (entryId: string) => Promise<string | null>;
    undoTurn: (turnId: string) => Promise<string | null>;
    newChat: () => void;
}

const persist = (thread: AssistantThread) => {
    saveThread(storage(), { ...thread, changes: changeLog.list() });
};

const attachLog = (set: (fn: (s: AssistantState) => Partial<AssistantState>) => void) => {
    changeLog.subscribe(() => set((s) => ({ logVersion: s.logVersion + 1 })));
};

export const useAssistantStore = create<AssistantState>((set, get) => {
    attachLog(set);
    const append = (messages: ThreadMessage[], extra: Partial<AssistantThread> = {}) => {
        const thread = { ...get().thread, ...extra, messages: [...get().thread.messages, ...messages] };
        set({ thread });
        persist(thread);
    };
    return {
        thread: loadThread(storage()),
        busy: false,
        logVersion: 0,
        hydrate: () => {
            const thread = loadThread(storage());
            changeLog = new AssistantChangeLog(thread.changes);
            attachLog(set);
            set({ thread, logVersion: get().logVersion + 1 });
        },
        send: async (text, language = 'en') => {
            const userText = text.trim();
            if (!userText || get().busy) return;
            const turnId = generateUUID();
            const history = toModelHistory(get().thread);
            const now = new Date().toISOString();
            append([{ id: generateUUID(), role: 'user', text: userText, createdAt: now, turnId }]);
            set({ busy: true });
            inFlight = new AbortController();
            try {
                const client = await createAssistantClient(language);
                const result = await runAssistantTurn({
                    client, port: createStoreAssistantPort(), changeLog, history, userText, messageId: turnId,
                    timeZone: timeZone(), signal: inFlight.signal,
                });
                append(
                    [{
                        id: generateUUID(), role: 'assistant', text: result.reply || 'Done.', createdAt: new Date().toISOString(), turnId,
                        ...(result.status === 'error' ? { isError: true } : {}),
                    }],
                    { pending: [...get().thread.pending, ...result.pending], changes: changeLog.list() },
                );
            } catch (error) {
                append([{ id: generateUUID(), role: 'assistant', text: error instanceof Error ? error.message : 'The assistant failed.', createdAt: new Date().toISOString(), isError: true, turnId }]);
            } finally {
                inFlight = null;
                set({ busy: false });
            }
        },
        stop: () => { inFlight?.abort(); },
        confirm: async (pendingId) => {
            const p = get().thread.pending.find((x) => x.id === pendingId);
            if (!p || p.status !== 'pending') return;
            const res = await executeConfirmed(p, { port: createStoreAssistantPort(), changeLog, timeZone: timeZone() });
            const pending = get().thread.pending.map((x) => (x.id === pendingId ? { ...x, status: res.ok ? 'confirmed' as const : 'pending' as const } : x));
            append(
                [{ id: generateUUID(), role: 'assistant', text: res.ok ? `Done: ${res.entry?.label ?? p.summary}.` : `Could not do that: ${res.error}`, createdAt: new Date().toISOString(), isError: !res.ok, turnId: p.messageId }],
                { pending, changes: changeLog.list() },
            );
        },
        reject: (pendingId) => {
            const pending = get().thread.pending.map((x) => (x.id === pendingId ? { ...x, status: 'rejected' as const } : x));
            const thread = { ...get().thread, pending };
            set({ thread });
            persist(thread);
        },
        undoEntry: async (entryId) => {
            const r = await changeLog.undo(entryId, createStoreAssistantPort());
            persist(get().thread);
            return r.ok ? null : r.error ?? 'Undo failed';
        },
        undoTurn: async (turnId) => {
            const r = await changeLog.undoMessage(turnId, createStoreAssistantPort());
            persist(get().thread);
            return r.ok ? null : r.error ?? 'Undo failed';
        },
        newChat: () => {
            inFlight?.abort();
            changeLog = new AssistantChangeLog();
            attachLog(set);
            set({ thread: clearThread(storage()), busy: false, logVersion: get().logVersion + 1 });
        },
    };
});

export const getAssistantChangeLog = () => changeLog;
