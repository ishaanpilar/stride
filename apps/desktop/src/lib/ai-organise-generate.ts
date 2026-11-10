import {
    PROJECT_ORDER_MAX_TASKS,
    PROJECT_ORDER_TIMEOUT_MS,
    TASK_GROUPING_MAX_TASKS,
    TASK_GROUPING_TIMEOUT_MS,
    compareTasksByProjectOrder,
    createAIProvider,
    createTaskLookup,
    generateProjectOrderProposal,
    generateTaskGroupingProposal,
    getOpenBlockers,
    isAIKeyRequired,
    projectPurpose,
    useTaskStore,
    type AIProvider,
    type Language,
    type ProjectOrderProposal,
    type Task,
    type TaskGroupingProposal,
} from '@stride/core';

import { buildAIConfig, loadAIKey } from './ai-config';
import { buildDesktopRoutingContext } from './ai-routing';
import { consumeAiUsage } from './ai-usage';
import { logWarn } from './app-log';

/** AI half of "Order this project" and "Group these": readiness, the usage guard and one bounded call each. */

export type AiOrganiseFailure = 'disabled' | 'limited' | 'failed' | 'empty';
export type AiOrganiseOutcome<T> = { status: 'ok'; proposal: T } | { status: 'unavailable'; reason: AiOrganiseFailure };

export const isAiOrganiseEnabled = (): boolean => useTaskStore.getState().settings?.ai?.enabled === true;

const unavailable = (reason: AiOrganiseFailure) => ({ status: 'unavailable', reason }) as const;

async function resolveProvider(language: Language, timeoutMs: number): Promise<AIProvider | AiOrganiseFailure> {
    const { settings } = useTaskStore.getState();
    if (settings?.ai?.enabled !== true) return 'disabled';
    const providerId = settings.ai?.provider ?? 'openai';
    const apiKey = await loadAIKey(providerId);
    if (!apiKey && isAIKeyRequired(settings)) return 'disabled';
    if (!consumeAiUsage('other').allowed) return 'limited';
    const config = await buildAIConfig(settings, apiKey, language);
    return createAIProvider({ ...config, timeoutMs: Math.min(config.timeoutMs ?? timeoutMs, timeoutMs) });
}

const isOpenTask = (task: Task): boolean => !task.deletedAt && !task.purgedAt
    && task.status !== 'done' && task.status !== 'archived' && task.status !== 'reference';

/** The project's open tasks, in their current order. */
export function getProjectOrderTasks(projectId: string): Task[] {
    return useTaskStore.getState()._allTasks
        .filter((task) => task.projectId === projectId && isOpenTask(task))
        .sort(compareTasksByProjectOrder);
}

export async function generateProjectOrder(projectId: string, language: Language = 'en'): Promise<AiOrganiseOutcome<ProjectOrderProposal>> {
    const state = useTaskStore.getState();
    const project = state.projects.find((candidate) => candidate.id === projectId && !candidate.deletedAt);
    const tasks = getProjectOrderTasks(projectId).slice(0, PROJECT_ORDER_MAX_TASKS);
    if (!project || tasks.length < 2) return unavailable('empty');
    try {
        const provider = await resolveProvider(language, PROJECT_ORDER_TIMEOUT_MS);
        if (typeof provider === 'string') return unavailable(provider);
        const lookup = createTaskLookup(useTaskStore.getState()._allTasks);
        const proposal = await generateProjectOrderProposal(provider, {
            projectId: project.id,
            projectTitle: project.title,
            projectPurpose: projectPurpose(project),
            routingContext: buildDesktopRoutingContext(),
            now: new Date(),
            lookup,
            tasks: tasks.map((task) => ({
                id: task.id,
                title: task.title,
                notes: task.description,
                dueDate: task.dueDate,
                status: task.status,
                blockedBy: getOpenBlockers(task, lookup).map((blocker) => blocker.id),
            })),
        }, { timeoutMs: PROJECT_ORDER_TIMEOUT_MS });
        return proposal ? { status: 'ok', proposal } : unavailable('failed');
    } catch (error) {
        void logWarn('Order project with AI failed', { scope: 'ai', extra: { error: error instanceof Error ? error.name : 'unknown' } });
        return unavailable('failed');
    }
}

/** For the Assistant's order_project tool. */
export async function generateProjectOrderProposalById(projectId: string, language: Language): Promise<ProjectOrderProposal | null> {
    const outcome = await generateProjectOrder(projectId, language);
    return outcome.status === 'ok' ? outcome.proposal : null;
}

export async function generateLooseGrouping(tasks: readonly Task[], language: Language = 'en'): Promise<AiOrganiseOutcome<TaskGroupingProposal>> {
    const open = tasks.filter(isOpenTask).slice(0, TASK_GROUPING_MAX_TASKS);
    if (open.length < 2) return unavailable('empty');
    try {
        const provider = await resolveProvider(language, TASK_GROUPING_TIMEOUT_MS);
        if (typeof provider === 'string') return unavailable(provider);
        const { projects, areas } = useTaskStore.getState();
        const liveAreas = areas.filter((area) => !area.deletedAt);
        const areaNameById = new Map(liveAreas.map((area) => [area.id, area.name]));
        const proposal = await generateTaskGroupingProposal(provider, {
            now: new Date(),
            routingContext: buildDesktopRoutingContext(),
            projects: projects.filter((project) => !project.deletedAt && !project.archivedAt && project.status !== 'archived').map((project) => project.title),
            areas: liveAreas.map((area) => area.name),
            tasks: open.map((task) => ({
                id: task.id,
                title: task.title,
                notes: task.description,
                dueDate: task.dueDate,
                areaName: task.areaId ? areaNameById.get(task.areaId) : undefined,
            })),
        }, { timeoutMs: TASK_GROUPING_TIMEOUT_MS });
        return proposal ? { status: 'ok', proposal } : unavailable('failed');
    } catch (error) {
        void logWarn('Group loose tasks with AI failed', { scope: 'ai', extra: { error: error instanceof Error ? error.name : 'unknown' } });
        return unavailable('failed');
    }
}
