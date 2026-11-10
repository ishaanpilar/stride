import { describe, expect, it } from 'vitest';
import { runToolCall } from './agent';
import { AssistantChangeLog } from './change-log';
import { buildSystemPrompt } from './prompt';
import { ASSISTANT_TOOLS } from './registry';
import { createFakePort } from './testing';

const NOW = new Date(2026, 10, 8, 9, 30, 0);
const exec = (port: any, log: AssistantChangeLog, name: string, args: unknown) =>
    runToolCall({ name, rawArguments: JSON.stringify(args), tools: ASSISTANT_TOOLS, ctx: { port, now: NOW }, changeLog: log, messageId: 'msg-1' } as any);
const parse = (result: { content: string }) => JSON.parse(result.content);

const seed = () => createFakePort({
    tasks: [
        { id: 'aaaaaaaa-0000', title: 'Book flights' },
        { id: 'bbbbbbbb-0000', title: 'Pack bags', blockedByTaskIds: ['aaaaaaaa-0000'] },
        { id: 'cccccccc-0000', title: 'Done thing', status: 'done' },
        { id: 'dddddddd-0000', title: 'Plan trip' },
    ],
});

describe('assistant dependency tools', () => {
    it('add_task resolves blockers by exact title', async () => {
        const { port, tasks } = seed();
        const result = await exec(port, new AssistantChangeLog(), 'add_task', { title: 'Check in', blockedBy: ['Book flights'] });
        expect(parse(result).ok ?? true).not.toBe(false);
        const created = tasks.find((t) => t.title === 'Check in');
        expect(created?.blockedByTaskIds).toEqual(['aaaaaaaa-0000']);
    });

    it('update_task sets blockers by short id and undo restores the old state', async () => {
        const { port, tasks } = seed();
        const log = new AssistantChangeLog();
        const result = await exec(port, log, 'update_task', { id: 'dddddddd', blockedBy: ['aaaaaaaa'] });
        expect(parse(result).error).toBeUndefined();
        expect(tasks.find((t) => t.id === 'dddddddd-0000')?.blockedByTaskIds).toEqual(['aaaaaaaa-0000']);
        const entry = log.list()[0];
        expect(entry.label).toContain('waits for other tasks');
        expect((await log.undo(entry.id, port)).ok).toBe(true);
        expect(tasks.find((t) => t.id === 'dddddddd-0000')).not.toHaveProperty('blockedByTaskIds');
    });

    it('update_task with null clears blockers', async () => {
        const { port, tasks } = seed();
        await exec(port, new AssistantChangeLog(), 'update_task', { id: 'bbbbbbbb', blockedBy: null });
        expect(tasks.find((t) => t.id === 'bbbbbbbb-0000')).not.toHaveProperty('blockedByTaskIds');
    });

    it('refuses a cycle with a clear tool error', async () => {
        const { port } = seed();
        const result = await exec(port, new AssistantChangeLog(), 'update_task', { id: 'aaaaaaaa', blockedBy: ['bbbbbbbb'] });
        expect(parse(result).error).toMatch(/already waits for/);
    });

    it('refuses a task waiting for itself, finished blockers and unknown tasks', async () => {
        const { port } = seed();
        const log = new AssistantChangeLog();
        expect(parse(await exec(port, log, 'update_task', { id: 'aaaaaaaa', blockedBy: ['Book flights'] })).error).toMatch(/itself/);
        expect(parse(await exec(port, log, 'add_task', { title: 'X', blockedBy: ['Done thing'] })).error).toMatch(/already finished/);
        expect(parse(await exec(port, log, 'add_task', { title: 'X', blockedBy: ['nonexistent task'] })).error).toMatch(/Unknown task/);
    });

    it('reports blockers in list_tasks and get_task', async () => {
        const { port } = seed();
        const listed = parse(await exec(port, new AssistantChangeLog(), 'list_tasks', {}));
        const rows = listed.tasks ?? listed.data?.tasks;
        const pack = rows.find((row: { title: string }) => row.title === 'Pack bags');
        expect(pack.waitsFor).toEqual([{ id: 'aaaaaaaa', title: 'Book flights' }]);

        const got = parse(await exec(port, new AssistantChangeLog(), 'get_task', { id: 'bbbbbbbb' }));
        const detail = got.data ?? got;
        expect(detail.blockedBy).toEqual([{ id: 'aaaaaaaa', title: 'Book flights', status: 'next', blocking: true }]);
    });

    it('complete_task asks first when the task is still waiting, and changes nothing', async () => {
        const { port, tasks } = seed();
        const result = await exec(port, new AssistantChangeLog(), 'complete_task', { id: 'bbbbbbbb' });
        expect(result.pending?.summary).toContain("waiting for 'Book flights'");
        expect(parse(result).status).toBe('needs_confirmation');
        expect(tasks.find((t) => t.id === 'bbbbbbbb-0000')?.status).not.toBe('done');
    });

    it('complete_task runs straight away once the blocker is finished', async () => {
        const { port, tasks } = seed();
        const log = new AssistantChangeLog();
        await exec(port, log, 'complete_task', { id: 'aaaaaaaa' });
        const result = await exec(port, log, 'complete_task', { id: 'bbbbbbbb' });
        expect(result.pending).toBeUndefined();
        expect(tasks.find((t) => t.id === 'bbbbbbbb-0000')?.status).toBe('done');
    });

    it('explains dependencies in the system prompt', () => {
        expect(buildSystemPrompt(seed().port, NOW)).toContain('Dependencies:');
    });
});
