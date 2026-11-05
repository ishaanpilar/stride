import { useSyncExternalStore } from 'react';
import {
    applyInboxProcessSuggestions,
    createAIProvider,
    generateInboxProcessProposal,
    INBOX_PROCESS_DEFAULT_TIMEOUT_MS,
    INBOX_PROCESS_MAX_ITEMS,
    isTaskVisibleInInbox,
    useTaskStore,
    type ApplyInboxProcessResult,
    type InboxProcessProposal,
    type InboxProcessSuggestion,
    type Language,
    type Task,
} from '@stride/core';

import { buildAIConfig, loadAIKey } from './ai-config';
import { consumeAiUsage } from './ai-usage';
import { buildDesktopRoutingContext, trackAiPlacement } from './ai-routing';
import { logWarn } from './app-log';
import { assistantChangeLog, createStoreAssistantPort } from './assistant-service';
import { isQuickCaptureAIReady } from './quick-capture-service';

/**
 * Process Inbox with AI (desktop wiring): readiness, the usage guard, one batched call with the
 * routing context, and applying the accepted suggestions as ONE change-log entry with undo.
 */

export type InboxProcessOutcome =
    | { status: 'ok'; proposal: InboxProcessProposal }
    | { status: 'unavailable'; reason: 'disabled' | 'limited' | 'failed' | 'empty' };

/** Live Inbox items, oldest first (the order they were captured). */
export function getInboxItemsForProcessing(): Task[] {
    const { tasks, projects } = useTaskStore.getState();
    const projectById = new Map(projects.map((project) => [project.id, project]));
    return tasks
        .filter((task) => task.status === 'inbox' && !task.deletedAt && isTaskVisibleInInbox(task, { projectById }))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function generateInboxProcessing(language: Language = 'en'): Promise<InboxProcessOutcome> {
    const items = getInboxItemsForProcessing().slice(0, INBOX_PROCESS_MAX_ITEMS);
    if (items.length === 0) return { status: 'unavailable', reason: 'empty' };
    try {
        if (!(await isQuickCaptureAIReady())) return { status: 'unavailable', reason: 'disabled' };
        if (!consumeAiUsage('capture').allowed) return { status: 'unavailable', reason: 'limited' };
        const { settings, projects, areas, tasks } = useTaskStore.getState();
        const provider = settings.ai?.provider ?? 'openai';
        const apiKey = await loadAIKey(provider);
        const config = await buildAIConfig(settings, apiKey, language);
        const aiProvider = createAIProvider({
            ...config,
            timeoutMs: Math.min(config.timeoutMs ?? INBOX_PROCESS_DEFAULT_TIMEOUT_MS, INBOX_PROCESS_DEFAULT_TIMEOUT_MS),
        });
        const activeProjects = projects.filter((p) => !p.deletedAt && !p.archivedAt && p.status !== 'archived');
        const contexts = Array.from(new Set(tasks.filter((t) => !t.deletedAt).flatMap((t) => t.contexts ?? []))).slice(0, 40);
        const proposal = await generateInboxProcessProposal(aiProvider, {
            items: items.map((task) => ({ id: task.id, title: task.title, notes: task.description })),
            now: new Date(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            projects: activeProjects.map((p) => p.title),
            areas: areas.filter((a) => !a.deletedAt).map((a) => a.name),
            contexts,
            routingContext: buildDesktopRoutingContext(),
        }, { timeoutMs: INBOX_PROCESS_DEFAULT_TIMEOUT_MS });
        return proposal ? { status: 'ok', proposal } : { status: 'unavailable', reason: 'failed' };
    } catch (error) {
        void logWarn('Process Inbox with AI failed', { scope: 'ai', extra: { error: error instanceof Error ? error.name : 'unknown' } });
        return { status: 'unavailable', reason: 'failed' };
    }
}

export type AppliedInboxProcess = ApplyInboxProcessResult & { changeId: string | null };

/** Apply accepted suggestions; records one change-log entry whose undo reverts the whole batch. */
export async function applyInboxProcessing(suggestions: readonly InboxProcessSuggestion[], label: string): Promise<AppliedInboxProcess> {
    const port = createStoreAssistantPort();
    const result = await applyInboxProcessSuggestions(suggestions, port);
    let changeId: string | null = null;
    if (result.undoOps.length > 0) {
        const entry = assistantChangeLog.record(`inbox-process:${Date.now()}`, 'process_inbox', {
            label,
            kind: 'plan',
            details: result.changes.slice(0, 20).map((change) => change.title),
            undoOps: result.undoOps,
            changes: result.changes,
        });
        changeId = entry.id;
    }
    const { _allTasks } = useTaskStore.getState();
    for (const id of result.updatedTaskIds) {
        const task = _allTasks.find((t) => t.id === id);
        if (task && (task.projectId || task.areaId)) trackAiPlacement(id, { title: task.title, projectId: task.projectId, areaId: task.areaId });
    }
    clearInboxSuggestions([...result.updatedTaskIds, ...result.deletedTaskIds]);
    return { ...result, changeId };
}

export async function undoInboxProcessing(changeId: string): Promise<boolean> {
    const outcome = await assistantChangeLog.undo(changeId, createStoreAssistantPort());
    return outcome.ok;
}

// --- Suggestions kept on Inbox rows (skipped or "needs you" items) -------------------------------

export const INBOX_SUGGESTIONS_STORAGE_KEY = 'stride:inbox:ai-suggestions:v1';
const MAX_STORED_SUGGESTIONS = 200;

export type StoredInboxSuggestion = Pick<InboxProcessSuggestion, 'kind' | 'needsYou' | 'reason' | 'projectName' | 'newProjectTitle' | 'areaName' | 'newAreaName'> & {
    at: string;
};

let suggestionCache: Record<string, StoredInboxSuggestion> | null = null;
const suggestionListeners = new Set<() => void>();

function readSuggestions(): Record<string, StoredInboxSuggestion> {
    try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(INBOX_SUGGESTIONS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) as unknown : null;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: Record<string, StoredInboxSuggestion> = {};
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (value && typeof value === 'object' && typeof (value as StoredInboxSuggestion).kind === 'string') {
                out[id] = value as StoredInboxSuggestion;
            }
        }
        return out;
    } catch {
        return {};
    }
}

function writeSuggestions(next: Record<string, StoredInboxSuggestion>): void {
    const entries = Object.entries(next).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_STORED_SUGGESTIONS);
    suggestionCache = Object.fromEntries(entries);
    try {
        localStorage.setItem(INBOX_SUGGESTIONS_STORAGE_KEY, JSON.stringify(suggestionCache));
    } catch {
        // Keep in memory only.
    }
    suggestionListeners.forEach((listener) => listener());
}

export function getInboxSuggestions(): Record<string, StoredInboxSuggestion> {
    suggestionCache ??= readSuggestions();
    return suggestionCache;
}

/** Remember the AI's suggestion for items that stay in the Inbox, so their rows show a chip. */
export function rememberInboxSuggestions(suggestions: readonly InboxProcessSuggestion[]): void {
    if (suggestions.length === 0) return;
    const at = new Date().toISOString();
    const next = { ...getInboxSuggestions() };
    for (const s of suggestions) {
        next[s.taskId] = {
            kind: s.kind, needsYou: s.needsYou, reason: s.reason, projectName: s.projectName,
            newProjectTitle: s.newProjectTitle, areaName: s.areaName, newAreaName: s.newAreaName, at,
        };
    }
    writeSuggestions(next);
}

export function clearInboxSuggestions(taskIds: readonly string[]): void {
    const current = getInboxSuggestions();
    if (!taskIds.some((id) => id in current)) return;
    const next = { ...current };
    for (const id of taskIds) delete next[id];
    writeSuggestions(next);
}

function subscribeSuggestions(listener: () => void): () => void {
    suggestionListeners.add(listener);
    return () => { suggestionListeners.delete(listener); };
}

export function useInboxSuggestions(): Record<string, StoredInboxSuggestion> {
    return useSyncExternalStore(subscribeSuggestions, getInboxSuggestions, getInboxSuggestions);
}

export function resetInboxSuggestionsForTests(): void {
    suggestionCache = null;
}
