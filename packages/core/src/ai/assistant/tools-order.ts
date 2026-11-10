import { applyProjectOrderProposal, projectOrderHasChanges, type ProjectOrderProposal } from '../project-order-ai';
import type { Project, Task } from '../../types';
import { fail, findProject, shortId } from './tools';
import type { AssistantTool, ToolContext } from './types';

const SUMMARY_LINE_LIMIT = 40;

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

/** The proposal comes back through the persisted confirmation, so its shape is checked again before use. */
function readProposal(value: unknown, projectId: string): ProjectOrderProposal | null {
    if (typeof value !== 'object' || value === null) return null;
    const raw = value as Record<string, unknown>;
    if (raw.projectId !== projectId) return null;
    const dependencies = (Array.isArray(raw.dependencies) ? raw.dependencies : []).flatMap((entry) => {
        const dep = entry as Record<string, unknown> | null;
        return dep && typeof dep.taskId === 'string' && typeof dep.blockerId === 'string'
            ? [{ taskId: dep.taskId, blockerId: dep.blockerId, reason: typeof dep.reason === 'string' ? dep.reason : '' }]
            : [];
    });
    return {
        projectId,
        order: strings(raw.order),
        dependencies,
        recommendNextActionOnly: raw.recommendNextActionOnly === true,
        independent: raw.independent === true,
        orderChanged: raw.orderChanged === true,
        summary: typeof raw.summary === 'string' ? raw.summary : '',
        source: 'ai',
    };
}

function describeProposal(proposal: ProjectOrderProposal, project: Project, tasks: readonly Task[]): string {
    const titleOf = (id: string) => tasks.find((task) => task.id === id)?.title ?? shortId(id);
    const afterByTask = new Map<string, string[]>();
    for (const dep of proposal.dependencies) {
        afterByTask.set(dep.taskId, [...(afterByTask.get(dep.taskId) ?? []), `${titleOf(dep.blockerId)} · ${dep.reason}`]);
    }
    const lines = proposal.order.slice(0, SUMMARY_LINE_LIMIT).map((id, index) => {
        const after = afterByTask.get(id);
        return `${index + 1}. ${titleOf(id)}${after ? ` (after: ${after.join('; ')})` : ''}`;
    });
    const notes: string[] = [];
    if (proposal.independent) notes.push('These can be done in any order, so nothing needs to block.');
    else if (proposal.summary) notes.push(proposal.summary);
    if (proposal.recommendNextActionOnly !== (project.isSequential === true)) {
        notes.push(proposal.recommendNextActionOnly ? 'Turn on Next action only.' : 'Turn off Next action only.');
    }
    return [`Order '${project.title}'`, ...lines, ...notes].join('\n');
}

const resolve = (ctx: ToolContext, ref: string): Project | string => {
    const found = findProject(ctx, ref);
    return 'error' in found ? found.error : found.project;
};

/**
 * Asks AI how to order a project, then shows the result on one confirmation card. The AI call runs in
 * `prepare`, so what the user confirms is exactly what is applied, as one undoable change.
 */
export const orderProjectTool: AssistantTool = {
    name: 'order_project',
    description: 'Ask AI to order one project\'s open tasks and find the real dependencies between them ("order the aircraft project", "what has to happen first"). The user sees the proposal on one Confirm card and gets one Undo. Nothing changes until they confirm.',
    mutating: true,
    parameters: {
        type: 'object',
        required: ['projectId'],
        properties: {
            projectId: { type: 'string', minLength: 1, description: 'Project id from list_projects, or its exact title.' },
            proposal: { type: 'object', additionalProperties: true, description: 'Reserved for the app. Never set this.' },
        },
    },
    validate: (a, ctx) => {
        const project = resolve(ctx, a.projectId);
        return typeof project === 'string' ? project : null;
    },
    prepare: async (a, ctx) => {
        const project = resolve(ctx, a.projectId) as Project;
        if (!ctx.port.generateProjectOrder) return { outcome: fail('AI ordering is not available here.') };
        const proposal = await ctx.port.generateProjectOrder(project.id);
        if (!proposal) return { outcome: fail('Could not get an order from AI right now. Nothing was changed; tell the user and suggest trying again.') };
        if (!projectOrderHasChanges(proposal, project)) {
            return { outcome: { ok: true, data: { status: 'no_change', message: proposal.independent ? 'These can be done in any order, and the project is already set up that way. Nothing to change.' : 'The project is already in this order. Nothing to change.' } } };
        }
        return { args: { ...a, projectId: project.id, proposal } };
    },
    confirmation: (a, ctx) => {
        const project = resolve(ctx, a.projectId) as Project;
        const proposal = readProposal(a.proposal, project.id);
        const { tasks } = ctx.port.getSnapshot();
        return {
            reason: 'Ordering a project',
            summary: proposal ? describeProposal(proposal, project, tasks) : `Order '${project.title}'`,
            affectedTaskIds: (proposal?.order ?? []).slice(0, 50),
        };
    },
    execute: async (a, ctx) => {
        const project = resolve(ctx, a.projectId);
        if (typeof project === 'string') return fail(project);
        const proposal = readProposal(a.proposal, project.id);
        if (!proposal) return fail('order_project needs its own confirmation; call it directly, not inside apply_plan.');
        const result = await applyProjectOrderProposal(proposal, {
            applyOrder: true,
            dependencies: proposal.dependencies,
            applyNextActionOnly: true,
        }, ctx.port);
        if (result.undoOps.length === 0) return fail(result.failed.length ? `Could not apply: ${result.failed.join(', ')}` : 'Nothing to change.');
        const parts = [
            result.reordered ? 'reordered' : '',
            result.addedDependencies ? `${result.addedDependencies} dependenc${result.addedDependencies === 1 ? 'y' : 'ies'}` : '',
            result.nextActionOnlyChanged ? 'Next action only' : '',
        ].filter(Boolean);
        return {
            ok: true,
            data: { reordered: result.reordered, addedDependencies: result.addedDependencies, nextActionOnlyChanged: result.nextActionOnlyChanged, failed: result.failed },
            change: { kind: 'project', label: `Ordered '${project.title}' · ${parts.join(', ')}`, undoOps: result.undoOps, changes: result.changes },
        };
    },
};
