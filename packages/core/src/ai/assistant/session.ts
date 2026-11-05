import { generateUUID } from '../../uuid';
import type { AppData } from '../../types';
import type { Language } from '../../i18n/i18n-types';
import { isAIKeyRequired } from '../../ai-config';
import type { AIProviderId } from '../types';
import { executeConfirmed, runAssistantTurn } from './agent';
import { AssistantChangeLog } from './change-log';
import { isAssistantProviderSupported } from './chat-client';
import {
    clearThread, loadThread, saveThread, toModelHistory,
    type AssistantThread, type ThreadMessage, type ThreadStorage,
} from './conversation';
import type { AssistantModelClient, AssistantStorePort } from './types';

export type AssistantReadiness =
    | { ready: true }
    | { ready: false; reason: 'disabled' | 'no-key' | 'unsupported-provider' };

/** Whether the Assistant can run with the current settings. `loadKey` reads the app's own key storage. */
export async function resolveAssistantReadiness(
    settings: AppData['settings'] | undefined,
    loadKey: (provider: AIProviderId) => Promise<string | null | undefined>,
): Promise<AssistantReadiness> {
    if (settings?.ai?.enabled !== true) return { ready: false, reason: 'disabled' };
    const provider = (settings.ai?.provider ?? 'openai') as AIProviderId;
    if (!isAssistantProviderSupported({ provider })) return { ready: false, reason: 'unsupported-provider' };
    if (isAIKeyRequired(settings)) {
        const key = await loadKey(provider);
        if (!key) return { ready: false, reason: 'no-key' };
    }
    return { ready: true };
}

export interface AssistantSessionState {
    thread: AssistantThread;
    busy: boolean;
    /** Bumps whenever the change log mutates so views re-render. */
    logVersion: number;
}

export interface AssistantSessionDeps {
    storage: ThreadStorage | null;
    createClient: (language: Language) => Promise<AssistantModelClient>;
    createPort: () => AssistantStorePort;
    timeZone?: () => string | undefined;
    /** Called after the change log mutates (e.g. to track AI placements for routing corrections). */
    onChangeLog?: (entries: ReturnType<AssistantChangeLog['list']>) => void;
}

/**
 * Framework-neutral Assistant conversation controller: the same flow as the desktop store
 * (send -> tool loop -> pending confirmations -> confirm/reject -> undo), observable via `subscribe`.
 */
export class AssistantSession {
    private state: AssistantSessionState;
    private changeLog: AssistantChangeLog;
    private inFlight: AbortController | null = null;
    private listeners = new Set<() => void>();
    private unsubscribeLog: (() => void) | null = null;

    constructor(private readonly deps: AssistantSessionDeps) {
        const thread = loadThread(deps.storage);
        this.changeLog = new AssistantChangeLog(thread.changes);
        this.state = { thread, busy: false, logVersion: 0 };
        this.attachLog();
    }

    getState = (): AssistantSessionState => this.state;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    private set(patch: Partial<AssistantSessionState>) {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach((l) => l());
    }

    private attachLog() {
        this.unsubscribeLog?.();
        this.unsubscribeLog = this.changeLog.subscribe(() => {
            this.deps.onChangeLog?.(this.changeLog.list());
            this.set({ logVersion: this.state.logVersion + 1 });
        });
    }

    private persist(thread: AssistantThread) {
        saveThread(this.deps.storage, { ...thread, changes: this.changeLog.list() });
    }

    private append(messages: ThreadMessage[], extra: Partial<AssistantThread> = {}) {
        const thread = { ...this.state.thread, ...extra, messages: [...this.state.thread.messages, ...messages] };
        this.set({ thread });
        this.persist(thread);
    }

    /** Re-read today's thread from storage (e.g. after the async storage cache warmed up). */
    hydrate = () => {
        const thread = loadThread(this.deps.storage);
        this.changeLog = new AssistantChangeLog(thread.changes);
        this.attachLog();
        this.set({ thread, logVersion: this.state.logVersion + 1 });
    };

    send = async (text: string, language: Language = 'en'): Promise<void> => {
        const userText = text.trim();
        if (!userText || this.state.busy) return;
        const turnId = generateUUID();
        const history = toModelHistory(this.state.thread);
        this.append([{ id: generateUUID(), role: 'user', text: userText, createdAt: new Date().toISOString(), turnId }]);
        this.set({ busy: true });
        const controller = new AbortController();
        this.inFlight = controller;
        try {
            const client = await this.deps.createClient(language);
            const result = await runAssistantTurn({
                client, port: this.deps.createPort(), changeLog: this.changeLog, history, userText, messageId: turnId,
                timeZone: this.deps.timeZone?.(), signal: controller.signal,
            });
            this.append(
                [{
                    id: generateUUID(), role: 'assistant', text: result.reply || 'Done.', createdAt: new Date().toISOString(), turnId,
                    ...(result.status === 'error' ? { isError: true } : {}),
                    ...(result.status !== 'error' && result.suggestions?.length ? { suggestions: result.suggestions } : {}),
                }],
                { pending: [...this.state.thread.pending, ...result.pending], changes: this.changeLog.list() },
            );
        } catch (error) {
            this.append([{
                id: generateUUID(), role: 'assistant', createdAt: new Date().toISOString(), isError: true, turnId,
                text: error instanceof Error ? error.message : 'The assistant failed.',
            }]);
        } finally {
            this.inFlight = null;
            this.set({ busy: false });
        }
    };

    stop = () => { this.inFlight?.abort(); };

    confirm = async (pendingId: string): Promise<void> => {
        const p = this.state.thread.pending.find((x) => x.id === pendingId);
        if (!p || p.status !== 'pending') return;
        const res = await executeConfirmed(p, { port: this.deps.createPort(), changeLog: this.changeLog, timeZone: this.deps.timeZone?.() });
        const pending = this.state.thread.pending.map((x) => (x.id === pendingId ? { ...x, status: res.ok ? 'confirmed' as const : 'pending' as const } : x));
        this.append(
            [{
                id: generateUUID(), role: 'assistant', createdAt: new Date().toISOString(), isError: !res.ok, turnId: p.messageId,
                text: res.ok ? `Done: ${res.entry?.label ?? p.summary}.` : `Could not do that: ${res.error}`,
            }],
            { pending, changes: this.changeLog.list() },
        );
    };

    reject = (pendingId: string): void => {
        const pending = this.state.thread.pending.map((x) => (x.id === pendingId ? { ...x, status: 'rejected' as const } : x));
        const thread = { ...this.state.thread, pending };
        this.set({ thread });
        this.persist(thread);
    };

    undoEntry = async (entryId: string): Promise<string | null> => {
        const r = await this.changeLog.undo(entryId, this.deps.createPort());
        this.persist(this.state.thread);
        return r.ok ? null : r.error ?? 'Undo failed';
    };

    undoTurn = async (turnId: string): Promise<string | null> => {
        const r = await this.changeLog.undoMessage(turnId, this.deps.createPort());
        this.persist(this.state.thread);
        return r.ok ? null : r.error ?? 'Undo failed';
    };

    newChat = () => {
        this.inFlight?.abort();
        this.changeLog = new AssistantChangeLog();
        this.attachLog();
        this.set({ thread: clearThread(this.deps.storage), busy: false, logVersion: this.state.logVersion + 1 });
    };
}
