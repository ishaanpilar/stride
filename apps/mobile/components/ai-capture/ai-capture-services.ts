import {
  applyAiCapture,
  createAssistantStorePort,
  generateAiCaptureProposal,
  undoAiCapture,
  useTaskStore,
  type AiCaptureDeps,
  type ApplyMindSweepResult,
  type Language,
  type MindSweepProposal,
} from '@stride/core';
import { buildAIConfig, loadAIKey } from '@/lib/ai-config';

export type AiCaptureApi = {
  generate: (text: string, language: Language) => Promise<MindSweepProposal>;
  apply: (proposal: Pick<MindSweepProposal, 'projects' | 'items'>) => Promise<ApplyMindSweepResult>;
  undo: (applied: Pick<ApplyMindSweepResult, 'projectIds' | 'taskIds'>) => Promise<boolean>;
};

const deps = (): AiCaptureDeps => ({
  getState: () => useTaskStore.getState(),
  loadKey: (provider) => loadAIKey(provider),
  buildConfig: (settings, apiKey, language) => buildAIConfig(settings, apiKey, language),
});

const port = () => createAssistantStorePort(() => useTaskStore.getState());

export const mobileAiCaptureApi: AiCaptureApi = {
  generate: (text, language) => generateAiCaptureProposal(deps(), text, language),
  apply: (proposal) => applyAiCapture(port(), proposal),
  undo: (applied) => undoAiCapture(port(), applied),
};
