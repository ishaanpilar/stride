import {
    TASK_FILL_TIMEOUT_MS,
    buildFallbackTaskFill,
    buildTaskFillInput,
    createAIProvider,
    fillTaskWithAI,
    isAIKeyRequired,
    resolveFeatureFlags,
    useTaskStore,
    type Language,
    type Task,
    type TaskFillCurrent,
    type TaskFillResult,
} from '@stride/core';
import { buildAIConfig, loadAIKey } from './ai-config';
import { buildDesktopRoutingContext } from './ai-routing';
import { consumeAiUsage } from './ai-usage';
import { logWarn } from './app-log';

export const isTaskFillAiEnabled = (): boolean => useTaskStore.getState().settings.ai?.enabled === true;

/**
 * "Fill with AI" for the task editor: one AI call that proposes values for the empty fields.
 * Never throws. With AI off, no key, the usage guard tripped, a timeout or bad output, it returns
 * the deterministic suggestions (area the title mentions, date the title names).
 */
export async function requestTaskFill(args: {
    task: Task;
    current: TaskFillCurrent;
    knownContexts: readonly string[];
    knownTags: readonly string[];
    language?: Language;
    now?: Date;
}): Promise<TaskFillResult> {
    const { settings, _allTasks, projects, areas, people } = useTaskStore.getState();
    const flags = resolveFeatureFlags(settings);
    const input = buildTaskFillInput({
        task: args.task,
        current: args.current,
        tasks: _allTasks,
        projects,
        areas,
        people,
        knownContexts: args.knownContexts,
        knownTags: args.knownTags,
        routingContext: buildDesktopRoutingContext(),
        prioritiesEnabled: flags.priorities,
        timeEstimatesEnabled: flags.timeEstimates,
        now: args.now,
    });
    try {
        if (settings.ai?.enabled !== true) return buildFallbackTaskFill(input);
        const providerId = settings.ai?.provider ?? 'openai';
        const apiKey = await loadAIKey(providerId);
        if (!apiKey && isAIKeyRequired(settings)) return buildFallbackTaskFill(input);
        if (!consumeAiUsage('other').allowed) return buildFallbackTaskFill(input);
        const config = await buildAIConfig(settings, apiKey, args.language ?? 'en');
        const provider = createAIProvider({ ...config, timeoutMs: TASK_FILL_TIMEOUT_MS });
        return await fillTaskWithAI(provider, input, { timeoutMs: TASK_FILL_TIMEOUT_MS });
    } catch (error) {
        void logWarn('Task fill with AI failed', { scope: 'ai', extra: { error: error instanceof Error ? error.name : 'unknown' } });
        return buildFallbackTaskFill(input);
    }
}
