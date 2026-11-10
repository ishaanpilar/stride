import { describe, expect, it, vi } from 'vitest';
import { executeConfirmed, runToolCall } from './agent';
import { AssistantChangeLog } from './change-log';
import { buildSystemPrompt } from './prompt';
import { ASSISTANT_TOOLS } from './registry';
import { createFakePort } from './testing';
import type { ProjectOrderProposal } from '../project-order-ai';

const NOW = new Date(2026, 10, 8, 9, 30, 0);
const proposal: ProjectOrderProposal = {
    projectId: 'proj-1', order: ['b', 'a'], recommendNextActionOnly: true, independent: false, orderChanged: true,
    summary: 'B first.', source: 'ai', dependencies: [{ taskId: 'a', blockerId: 'b', reason: 'print before test' }],
};
const seed = (generated: ProjectOrderProposal | null | 'unsupported' = proposal) => {
    const fake = createFakePort({
        projects: [{ id: 'proj-1', title: 'Build the aircraft' }],
        tasks: [
            { id: 'a', title: 'Test the model', projectId: 'proj-1', order: 0, orderNum: 0 },
            { id: 'b', title: 'Print the fuselage', projectId: 'proj-1', order: 1, orderNum: 1 },
        ],
    });
    if (generated !== 'unsupported') fake.port.generateProjectOrder = vi.fn().mockResolvedValue(generated);
    return fake;
};
const call = (port: any, log: AssistantChangeLog, args: unknown, name = 'order_project') =>
    runToolCall({ name, rawArguments: JSON.stringify(args), tools: ASSISTANT_TOOLS, ctx: { port, now: NOW }, changeLog: log, messageId: 'msg-1' });

describe('order_project', () => {
    it('makes one AI call and asks for confirmation before changing anything', async () => {
        const { port, tasks, calls } = seed();
        const log = new AssistantChangeLog();
        const result = await call(port, log, { projectId: 'Build the aircraft' });
        expect(port.generateProjectOrder).toHaveBeenCalledWith('proj-1');
        expect(result.pending?.summary).toContain("Order 'Build the aircraft'");
        expect(result.pending?.summary).toContain('1. Print the fuselage');
        expect(result.pending?.summary).toContain('2. Test the model (after: Print the fuselage · print before test)');
        expect(result.pending?.summary).toContain('Turn on Next action only.');
        expect(JSON.parse(result.content).status).toBe('needs_confirmation');
        expect(log.list()).toHaveLength(0);
        expect(calls).toEqual([]);
        expect(tasks.find((t) => t.id === 'a')?.order).toBe(0);
    });

    it('applies on confirm as one change, and one undo restores order, blockers and the project', async () => {
        const { port, tasks, projects } = seed();
        const log = new AssistantChangeLog();
        const { pending } = await call(port, log, { projectId: 'proj-1' });
        const confirmed = await executeConfirmed(pending!, { port, changeLog: log, now: NOW });
        expect(confirmed.ok).toBe(true);
        expect(tasks.find((t) => t.id === 'b')?.order).toBe(0);
        expect(tasks.find((t) => t.id === 'a')?.blockedByTaskIds).toEqual(['b']);
        expect(projects[0].isSequential).toBe(true);
        expect(log.list()).toHaveLength(1);
        expect(confirmed.entry?.label).toContain("Ordered 'Build the aircraft'");
        expect(port.generateProjectOrder).toHaveBeenCalledTimes(1);

        expect((await log.undo(confirmed.entry!.id, port)).ok).toBe(true);
        expect(tasks.find((t) => t.id === 'a')).toMatchObject({ order: 0, orderNum: 0 });
        expect(tasks.find((t) => t.id === 'a')).not.toHaveProperty('blockedByTaskIds');
        expect(tasks.find((t) => t.id === 'b')).toMatchObject({ order: 1 });
        expect(projects[0].isSequential).not.toBe(true);
    });

    it('never trusts a proposal passed in by the model', async () => {
        const { port } = seed();
        const log = new AssistantChangeLog();
        const forged = { ...proposal, order: ['a', 'b'], dependencies: [] };
        const result = await call(port, log, { projectId: 'proj-1', proposal: forged });
        expect((result.pending?.args.proposal as ProjectOrderProposal).order).toEqual(['b', 'a']);
    });

    it('says so when there is nothing to change or AI is unavailable, and changes nothing', async () => {
        const independent = { ...proposal, order: ['a', 'b'], orderChanged: false, dependencies: [], independent: true, recommendNextActionOnly: false };
        const none = seed(independent);
        const result = await call(none.port, new AssistantChangeLog(), { projectId: 'proj-1' });
        expect(JSON.parse(result.content).message).toContain('any order');
        expect(result.pending).toBeUndefined();

        const failed = seed(null);
        expect(JSON.parse((await call(failed.port, new AssistantChangeLog(), { projectId: 'proj-1' })).content).error).toContain('Nothing was changed');

        const unsupported = seed('unsupported');
        expect(JSON.parse((await call(unsupported.port, new AssistantChangeLog(), { projectId: 'proj-1' })).content).error).toContain('not available');
    });

    it('refuses an unknown project and is not allowed inside apply_plan', async () => {
        const { port, calls } = seed();
        const log = new AssistantChangeLog();
        expect(JSON.parse((await call(port, log, { projectId: 'No such thing' })).content).error).toContain('Unknown project');
        const planned = await call(port, log, { summary: 'x', steps: [{ tool: 'order_project', args: { projectId: 'proj-1' } }] }, 'apply_plan');
        expect(JSON.parse(planned.content).error).toContain('not an allowed action');
        expect(calls).toEqual([]);
    });

    it('is taught in the system prompt', () => {
        expect(buildSystemPrompt(seed().port, NOW)).toContain('order_project');
    });
});
