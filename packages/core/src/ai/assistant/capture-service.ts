import type { AppData } from '../../types';
import type { Language } from '../../i18n/i18n-types';
import { isAIKeyRequired } from '../../ai-config';
import { createAIProvider } from '../ai-service';
import {
    applyMindSweepProposal, buildFallbackMindSweepProposal, generateMindSweepProposal, undoMindSweep,
    type ApplyMindSweepResult, type MindSweepProposal,
} from '../mind-sweep-ai';
import { buildRoutingContext } from '../routing-context';
import type { RoutingCorrection } from '../routing-corrections';
import type { AIProviderConfig, AIProviderId } from '../types';
import type { useTaskStore } from '../../store';
import type { AssistantStorePort } from './types';

type StoreState = ReturnType<typeof useTaskStore.getState>;

export const AI_CAPTURE_TIMEOUT_MS = 45_000;

export interface AiCaptureDeps {
    getState: () => StoreState;
    loadKey: (provider: AIProviderId) => Promise<string | null | undefined>;
    buildConfig: (settings: AppData['settings'], apiKey: string, language: Language) => AIProviderConfig;
    getRoutingCorrections?: () => RoutingCorrection[];
    /** Test seam: replaces the real provider factory. */
    createProvider?: typeof createAIProvider;
}

export async function isAiCaptureReady(
    settings: AppData['settings'] | undefined,
    loadKey: AiCaptureDeps['loadKey'],
): Promise<boolean> {
    if (settings?.ai?.enabled !== true) return false;
    if (!isAIKeyRequired(settings)) return true;
    return Boolean(await loadKey((settings.ai?.provider ?? 'openai') as AIProviderId));
}

/**
 * Organise a brain dump into a proposal. Never throws: falls back to one Inbox item per line
 * when AI is off, unconfigured, times out, or returns something unusable.
 */
export async function generateAiCaptureProposal(deps: AiCaptureDeps, text: string, language: Language = 'en'): Promise<MindSweepProposal> {
    const now = new Date();
    const { settings, projects, areas, tasks, people } = deps.getState();
    const activeProjects = projects.filter((p) => !p.deletedAt && !p.archivedAt && p.status !== 'archived');
    const fallback = (reason: 'disabled' | 'failed') => buildFallbackMindSweepProposal(text, reason, now, activeProjects, areas, people);
    try {
        if (!(await isAiCaptureReady(settings, deps.loadKey))) return fallback('disabled');
        const provider = (settings.ai?.provider ?? 'openai') as AIProviderId;
        const apiKey = (await deps.loadKey(provider)) ?? '';
        const config = deps.buildConfig(settings, apiKey, language);
        const aiProvider = (deps.createProvider ?? createAIProvider)({ ...config, timeoutMs: Math.min(config.timeoutMs ?? AI_CAPTURE_TIMEOUT_MS, AI_CAPTURE_TIMEOUT_MS) });
        const contexts = Array.from(new Set(tasks.filter((t) => !t.deletedAt).flatMap((t) => t.contexts ?? []))).slice(0, 40);
        const proposal = await generateMindSweepProposal(aiProvider, {
            text,
            now,
            timeZone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })(),
            projects: activeProjects.map((p) => p.title),
            areas: areas.filter((a) => !a.deletedAt).map((a) => a.name),
            contexts,
            routingContext: buildRoutingContext({ areas, projects, people, corrections: deps.getRoutingCorrections?.() ?? [] }).text,
        }, { timeoutMs: AI_CAPTURE_TIMEOUT_MS });
        return proposal ?? fallback('failed');
    } catch {
        return fallback('failed');
    }
}

export function applyAiCapture(port: AssistantStorePort, proposal: Pick<MindSweepProposal, 'projects' | 'items'>): Promise<ApplyMindSweepResult> {
    return applyMindSweepProposal(proposal, port);
}

export function undoAiCapture(port: AssistantStorePort, applied: Pick<ApplyMindSweepResult, 'projectIds' | 'taskIds'>): Promise<boolean> {
    return undoMindSweep(applied, port);
}
