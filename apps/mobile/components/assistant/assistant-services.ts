import {
  AssistantSession,
  createAssistantChatClient,
  createAssistantStorePort,
  resolveAssistantReadiness,
  useTaskStore,
  type AssistantModelClient,
  type AssistantReadiness,
  type AssistantStorePort,
  type Language,
} from '@stride/core';
import { buildAIConfig, loadAIKey } from '@/lib/ai-config';
import { createCachedThreadStorage } from './thread-storage';

export const createMobileAssistantPort = (): AssistantStorePort =>
  createAssistantStorePort(() => useTaskStore.getState());

export async function createMobileAssistantClient(language: Language = 'en'): Promise<AssistantModelClient> {
  const { settings } = useTaskStore.getState();
  const provider = settings.ai?.provider ?? 'openai';
  const apiKey = await loadAIKey(provider);
  return createAssistantChatClient(buildAIConfig(settings, apiKey, language));
}

export function getMobileAssistantReadiness(): Promise<AssistantReadiness> {
  return resolveAssistantReadiness(useTaskStore.getState().settings, (provider) => loadAIKey(provider));
}

const timeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
};

let shared: { session: AssistantSession; warm: () => Promise<void> } | null = null;

/** One Assistant conversation per app run, persisted per day like desktop. */
export function getMobileAssistantSession() {
  if (!shared) {
    const { storage, warm } = createCachedThreadStorage();
    shared = {
      warm,
      session: new AssistantSession({
        storage,
        createClient: createMobileAssistantClient,
        createPort: createMobileAssistantPort,
        timeZone,
      }),
    };
  }
  return shared;
}
