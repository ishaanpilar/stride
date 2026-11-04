import {
    applyMindSweepProposal,
    buildFallbackMindSweepProposal,
    createAIProvider,
    generateMindSweepProposal,
    isAIKeyRequired,
    undoMindSweep,
    useTaskStore,
    type ApplyMindSweepResult,
    type Language,
    type MindSweepProposal,
} from '@stride/core';
import { buildAIConfig, loadAIKey } from './ai-config';
import { logWarn } from './app-log';
import { createStoreAssistantPort } from './assistant-service';

export const QUICK_CAPTURE_EVENT = 'stride:quick-capture';
export const QUICK_CAPTURE_TIMEOUT_MS = 45_000;

export function openQuickCapture(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(QUICK_CAPTURE_EVENT));
}

/** Whether AI organising can run (enabled + key present when one is required). */
export async function isQuickCaptureAIReady(): Promise<boolean> {
    const { settings } = useTaskStore.getState();
    if (settings.ai?.enabled !== true) return false;
    if (!isAIKeyRequired(settings)) return true;
    return Boolean(await loadAIKey(settings.ai?.provider ?? 'openai'));
}

/**
 * Organise a brain dump into a proposal. Never throws: falls back to one Inbox item per line
 * when AI is off, unconfigured, times out, or returns something unusable.
 */
export async function generateQuickCaptureProposal(text: string, language: Language = 'en'): Promise<MindSweepProposal> {
    const now = new Date();
    const { settings, projects, areas, tasks } = useTaskStore.getState();
    const activeProjects = projects.filter((p) => !p.deletedAt && !p.archivedAt && p.status !== 'archived');
    const fallback = (reason: 'disabled' | 'failed') => buildFallbackMindSweepProposal(text, reason, now, activeProjects, areas);
    try {
        if (!(await isQuickCaptureAIReady())) return fallback('disabled');
        const provider = settings.ai?.provider ?? 'openai';
        const apiKey = await loadAIKey(provider);
        const config = await buildAIConfig(settings, apiKey, language);
        const aiProvider = createAIProvider({ ...config, timeoutMs: Math.min(config.timeoutMs ?? QUICK_CAPTURE_TIMEOUT_MS, QUICK_CAPTURE_TIMEOUT_MS) });
        const contexts = Array.from(new Set(tasks.filter((t) => !t.deletedAt).flatMap((t) => t.contexts ?? []))).slice(0, 40);
        const proposal = await generateMindSweepProposal(aiProvider, {
            text,
            now,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            projects: activeProjects.map((p) => p.title),
            areas: areas.filter((a) => !a.deletedAt).map((a) => a.name),
            contexts,
        }, { timeoutMs: QUICK_CAPTURE_TIMEOUT_MS });
        return proposal ?? fallback('failed');
    } catch (error) {
        void logWarn('Quick capture generation failed', { scope: 'ai', extra: { error: error instanceof Error ? error.name : 'unknown' } });
        return fallback('failed');
    }
}

export function applyQuickCapture(proposal: Pick<MindSweepProposal, 'projects' | 'items'>): Promise<ApplyMindSweepResult> {
    return applyMindSweepProposal(proposal, createStoreAssistantPort());
}

export function undoQuickCapture(applied: Pick<ApplyMindSweepResult, 'projectIds' | 'taskIds'>): Promise<boolean> {
    return undoMindSweep(applied, createStoreAssistantPort());
}
