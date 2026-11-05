import {
    AssistantChangeLog,
    createAssistantChatClient,
    isAIKeyRequired,
    isAssistantProviderSupported,
    useTaskStore,
    type AssistantModelClient,
    type AssistantStorePort,
    type Language,
} from '@stride/core';
import { buildAIConfig, loadAIKey } from './ai-config';
import { loadRoutingCorrections } from './ai-routing';

export type AssistantReadiness =
    | { ready: true }
    | { ready: false; reason: 'disabled' | 'no-key' | 'unsupported-provider' };

/** Tools run through the same Zustand store actions the UI uses, so sync/undo/UI stay consistent. */
export function createStoreAssistantPort(): AssistantStorePort {
    const st = () => useTaskStore.getState();
    return {
        getSnapshot: () => {
            const s = st();
            return { tasks: s.tasks, projects: s.projects, areas: s.areas, people: s.people };
        },
        addTask: (title, props) => st().addTask(title, props),
        updateTask: (id, updates) => st().updateTask(id, updates),
        completeTask: (id) => st().moveTask(id, 'done'),
        deleteTask: (id) => st().deleteTask(id),
        restoreTask: (id) => st().restoreTask(id),
        addProject: (title, color, props) => st().addProject(title, color, props),
        deleteProject: (id) => st().deleteProject(id),
        restoreProject: (id) => st().restoreProject(id),
        updateProject: (id, updates) => st().updateProject(id, updates),
        addArea: (name, props) => st().addArea(name, props),
        updateArea: (id, updates) => st().updateArea(id, updates),
        deleteArea: (id) => st().deleteArea(id),
        restoreArea: (id) => st().restoreArea(id),
        addPerson: (name) => st().addPerson(name),
        deletePerson: (id) => st().deletePerson(id),
        getRoutingCorrections: () => loadRoutingCorrections(),
    };
}

export async function getAssistantReadiness(): Promise<AssistantReadiness> {
    const { settings } = useTaskStore.getState();
    if (settings.ai?.enabled !== true) return { ready: false, reason: 'disabled' };
    const provider = settings.ai?.provider ?? 'openai';
    if (!isAssistantProviderSupported({ provider })) return { ready: false, reason: 'unsupported-provider' };
    if (isAIKeyRequired(settings)) {
        const key = await loadAIKey(provider);
        if (!key) return { ready: false, reason: 'no-key' };
    }
    return { ready: true };
}

export async function createAssistantClient(language: Language = 'en'): Promise<AssistantModelClient> {
    const { settings } = useTaskStore.getState();
    const provider = settings.ai?.provider ?? 'openai';
    const apiKey = await loadAIKey(provider);
    // Tool loops make several calls; allow a longer per-call budget than one-shot features.
    const config = await buildAIConfig(settings, apiKey, language);
    return createAssistantChatClient(config);
}

export const assistantChangeLog = new AssistantChangeLog();
