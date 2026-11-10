import {
    AssistantChangeLog,
    createAssistantStorePort,
    createAssistantChatClient,
    isAIKeyRequired,
    isAssistantProviderSupported,
    useTaskStore,
    type AssistantModelClient,
    type AssistantStorePort,
    type Language,
} from '@stride/core';
import { buildAIConfig, loadAIKey } from './ai-config';
import { generateProjectOrderProposalById } from './ai-organise-generate';
import { loadRoutingCorrections } from './ai-routing';
import { getCurrentUiLanguage } from '../contexts/language-context';

export type AssistantReadiness =
    | { ready: true }
    | { ready: false; reason: 'disabled' | 'no-key' | 'unsupported-provider' };

/** Tools run through the same Zustand store actions the UI uses, so sync/undo/UI stay consistent. */
export function createStoreAssistantPort(): AssistantStorePort {
    return {
        ...createAssistantStorePort(() => useTaskStore.getState(), () => loadRoutingCorrections()),
        generateProjectOrder: (projectId) => generateProjectOrderProposalById(projectId, getCurrentUiLanguage()),
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
