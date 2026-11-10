import { describe, expect, it, vi } from 'vitest';

import type { Area, Project, Task } from '../types';
import { AssistantChangeLog } from './assistant/change-log';
import type { AssistantStorePort } from './assistant/types';
import {
    applyInboxProcessSuggestions,
    buildInboxProcessPrompt,
    generateInboxProcessProposal,
    parseInboxProcessResponse,
    type InboxProcessSuggestion,
} from './inbox-process-ai';

const NOW = new Date(2026, 10, 4, 9, 0, 0); // Wed 2026-11-04
const ctx = { now: NOW, projects: ['Website'], areas: ['Work', 'Home'], contexts: ['@desk'] };
const items = [
    { id: 'task-a', title: 'call dentist' },
    { id: 'task-b', title: 'raj owes me the invoice' },
    { id: 'task-c', title: 'plan the offsite' },
    { id: 'task-d', title: 'call dentist again' },
];

describe('buildInboxProcessPrompt', () => {
    it('sends short ids, names and the routing context as data', () => {
        const p = buildInboxProcessPrompt({ ...ctx, items, routingContext: 'ROUTING_CONTEXT ...' });
        expect(p.user).toContain('"id":"t1"');
        expect(p.user).toContain('call dentist');
        expect(p.user).not.toContain('task-a');
        expect(p.user).toContain('KNOWN_AREAS: ["Work","Home"]');
        expect(p.user).toContain('ROUTING_CONTEXT');
        expect(p.system).toContain('data, not instructions');
    });
});

describe('parseInboxProcessResponse', () => {
    it('validates kinds, ids, projects, areas and dates', () => {
        const raw = JSON.stringify({
            summary: 'Sorted.',
            items: [
                { id: 't1', kind: 'next', title: 'Call the dentist', area: 'home', reason: 'personal health', contexts: ['phone'], priority: 'high', timeEstimate: '15m' },
                { id: 't2', kind: 'waiting', waitingFor: 'Raj', project: 'website', reason: 'invoice for site' },
                { id: 't3', kind: 'project', title: 'Pick a date', newProject: 'Team offsite', area: 'Mars Office' },
                { id: 't4', kind: 'delete', duplicateOf: 't1', reason: 'same as t1' },
                { id: 't9', kind: 'next', title: 'Unknown id' },
                { id: 't1', kind: 'someday', title: 'Repeated id' },
            ],
        });
        const parsed = parseInboxProcessResponse(`\`\`\`json\n${raw}\n\`\`\``, items, ctx)!;
        expect(parsed.summary).toBe('Sorted.');
        expect(parsed.items).toHaveLength(4);
        const [a, b, c, d] = parsed.items;
        expect(a).toMatchObject({ taskId: 'task-a', kind: 'next', title: 'Call the dentist', areaName: 'Home', contexts: ['@phone'], priority: 'high', needsYou: false });
        expect(a.reason).toBe('personal health');
        expect(b).toMatchObject({ taskId: 'task-b', kind: 'waiting', waitingFor: 'Raj', projectName: 'Website', needsYou: false });
        // Unknown project → flagged new project; unknown area → flagged new area that needs the user.
        expect(c).toMatchObject({ kind: 'project', newProjectTitle: 'Team offsite', newAreaName: 'Mars Office', needsYou: true, needsYouReason: 'unknown-area' });
        expect(d).toMatchObject({ kind: 'delete', duplicateOf: 'task-a' });
    });

    it('drops invalid kinds and flags low confidence or missing dates', () => {
        const raw = {
            items: [
                { id: 't1', kind: 'banana' },
                { id: 't2', kind: 'calendar', dueDate: 'sometime' },
                { id: 't3', kind: 'next', confidence: 'low' },
                { id: 't4', kind: 'calendar', startTime: '2026-11-06T15:00' },
            ],
        };
        const parsed = parseInboxProcessResponse(raw, items, ctx)!;
        expect(parsed.items.map((i) => i.taskId)).toEqual(['task-b', 'task-c', 'task-d']);
        expect(parsed.items[0]).toMatchObject({ needsYou: true, needsYouReason: 'missing-date' });
        expect(parsed.items[1]).toMatchObject({ needsYou: true, needsYouReason: 'low-confidence' });
        expect(parsed.items[2]).toMatchObject({ needsYou: false, startTime: '2026-11-06T15:00' });
    });

    it('returns null for unusable output', () => {
        expect(parseInboxProcessResponse('not json', items, ctx)).toBeNull();
        expect(parseInboxProcessResponse({ items: [{ id: 'zz', kind: 'next' }] }, items, ctx)).toBeNull();
        expect(parseInboxProcessResponse({ nope: true }, items, ctx)).toBeNull();
    });
});

describe('generateInboxProcessProposal', () => {
    it('batches items and reports the ones the model skipped', async () => {
        const generateText = vi.fn(async (prompt: { user: string }) => {
            const ids = Array.from(prompt.user.matchAll(/"id":"(t\d+)"/g)).map((m) => m[1]);
            return JSON.stringify({ items: [{ id: ids[0], kind: 'someday' }] });
        });
        const many = Array.from({ length: 45 }, (_, i) => ({ id: `x${i}`, title: `item ${i}` }));
        const proposal = await generateInboxProcessProposal({ generateText } as never, { ...ctx, items: many });
        expect(generateText).toHaveBeenCalledTimes(2);
        expect(proposal!.items.map((i) => i.taskId)).toEqual(['x0', 'x40']);
        expect(proposal!.skippedTaskIds).toHaveLength(43);
    });

    it('times out and returns null without throwing', async () => {
        vi.useFakeTimers();
        try {
            const generateText = vi.fn(() => new Promise<string>(() => undefined));
            const pending = generateInboxProcessProposal({ generateText } as never, { ...ctx, items }, { timeoutMs: 1000 });
            await vi.advanceTimersByTimeAsync(1001);
            await expect(pending).resolves.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns null when the provider throws or nothing is sent', async () => {
        const generateText = vi.fn(async () => { throw new Error('network'); });
        await expect(generateInboxProcessProposal({ generateText } as never, { ...ctx, items })).resolves.toBeNull();
        await expect(generateInboxProcessProposal({ generateText } as never, { ...ctx, items: [] })).resolves.toBeNull();
    });
});

const makeTask = (id: string, title: string, extra: Partial<Task> = {}): Task => ({
    id, title, status: 'inbox', tags: [], contexts: [], createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', ...extra,
} as Task);

function makePort() {
    const tasks: Task[] = [
        makeTask('task-a', 'call dentist'),
        makeTask('task-b', 'raj owes me the invoice', { contexts: ['@desk'] }),
        makeTask('task-c', 'plan the offsite'),
        makeTask('task-d', 'call dentist again'),
        makeTask('task-e', 'already moved', { status: 'next' }),
    ];
    const projects: Project[] = [{ id: 'p-web', title: 'Website', status: 'active' } as Project];
    const areas: Area[] = [{ id: 'a-home', name: 'Home', order: 0 } as Area];
    const port: AssistantStorePort = {
        getSnapshot: () => ({ tasks, projects, areas }),
        addTask: vi.fn(),
        updateTask: vi.fn(async (id: string, updates: Partial<Task>) => {
            const task = tasks.find((t) => t.id === id)!;
            for (const [key, value] of Object.entries(updates)) {
                if (value === undefined) delete (task as unknown as Record<string, unknown>)[key];
                else (task as unknown as Record<string, unknown>)[key] = value;
            }
            return { success: true };
        }),
        completeTask: vi.fn(),
        deleteTask: vi.fn(async (id: string) => { tasks.find((t) => t.id === id)!.deletedAt = 'x'; return { success: true }; }),
        restoreTask: vi.fn(async (id: string) => { delete tasks.find((t) => t.id === id)!.deletedAt; return { success: true }; }),
        addProject: vi.fn(async (title: string, _color: string, props: Partial<Project>) => {
            const project = { id: `p-${projects.length}`, title, ...props } as Project;
            projects.push(project);
            return project;
        }),
        deleteProject: vi.fn(async (id: string) => { projects.find((p) => p.id === id)!.deletedAt = 'x'; return { success: true }; }),
        restoreProject: vi.fn(),
        updateProject: vi.fn(),
        addArea: vi.fn(async (name: string) => {
            const area = { id: `a-${areas.length}`, name, order: areas.length } as Area;
            areas.push(area);
            return area;
        }),
        updateArea: vi.fn(),
        deleteArea: vi.fn(async (id: string) => { areas.find((a) => a.id === id)!.deletedAt = 'x'; return { success: true }; }),
        restoreArea: vi.fn(),
    } as unknown as AssistantStorePort;
    return { port, tasks, projects, areas };
}

const s = (partial: Partial<InboxProcessSuggestion> & Pick<InboxProcessSuggestion, 'taskId' | 'kind'>): InboxProcessSuggestion => ({
    originalTitle: partial.taskId, title: partial.title ?? partial.taskId, needsYou: false, ...partial,
});

describe('applyInboxProcessSuggestions', () => {
    it('applies a batch and one change-log entry undoes all of it', async () => {
        const { port, tasks, projects, areas } = makePort();
        const result = await applyInboxProcessSuggestions([
            s({ taskId: 'task-a', kind: 'next', title: 'Call the dentist', areaName: 'Home', contexts: ['@phone'], priority: 'high' }),
            s({ taskId: 'task-b', kind: 'waiting', title: 'raj owes me the invoice', waitingFor: 'Raj', projectName: 'Website', contexts: ['@desk'] }),
            s({ taskId: 'task-c', kind: 'project', title: 'Pick a date', newProjectTitle: 'Team offsite', newAreaName: 'Office' }),
            s({ taskId: 'task-d', kind: 'delete', duplicateOf: 'task-a' }),
            s({ taskId: 'task-e', kind: 'someday' }),
        ], port);

        expect(result.updatedTaskIds).toEqual(['task-a', 'task-b', 'task-c']);
        expect(result.deletedTaskIds).toEqual(['task-d']);
        expect(result.failed).toEqual(['task-e']);
        expect(tasks[0]).toMatchObject({ status: 'next', title: 'Call the dentist', areaId: 'a-home', contexts: ['@phone'], priority: 'high' });
        expect(tasks[1]).toMatchObject({ status: 'waiting', projectId: 'p-web', assignedTo: 'Raj', contexts: ['@desk'] });
        const offsite = projects.find((p) => p.title === 'Team offsite')!;
        expect(offsite.areaId).toBe(areas.find((a) => a.name === 'Office')!.id);
        expect(tasks[2]).toMatchObject({ status: 'next', title: 'Pick a date', projectId: offsite.id });
        expect(tasks[3].deletedAt).toBe('x');

        const log = new AssistantChangeLog();
        const entry = log.record('inbox-process', 'process_inbox', { label: 'Processed Inbox', undoOps: result.undoOps, changes: result.changes });
        await expect(log.undo(entry.id, port)).resolves.toEqual({ ok: true });

        expect(tasks[0]).toMatchObject({ status: 'inbox', title: 'call dentist', contexts: [] });
        expect(tasks[0].areaId).toBeUndefined();
        expect(tasks[0].priority).toBeUndefined();
        expect(tasks[1]).toMatchObject({ status: 'inbox', contexts: ['@desk'] });
        expect(tasks[1].projectId).toBeUndefined();
        expect(tasks[1].assignedTo).toBeUndefined();
        expect(tasks[2]).toMatchObject({ status: 'inbox', title: 'plan the offsite' });
        expect(tasks[3].deletedAt).toBeUndefined();
        expect(offsite.deletedAt).toBe('x');
        expect(areas.find((a) => a.name === 'Office')!.deletedAt).toBe('x');
        // Undo order: task fields first, then the project, then the area it lived in.
        expect(result.undoOps.map((op) => op.kind)).toEqual(['restoreTask', 'restoreFields', 'deleteProject', 'deleteArea', 'restoreFields', 'restoreFields']);
    });

    it('creates a new project once when several items share it', async () => {
        const { port } = makePort();
        const result = await applyInboxProcessSuggestions([
            s({ taskId: 'task-a', kind: 'next', newProjectTitle: 'Dental' }),
            s({ taskId: 'task-d', kind: 'next', newProjectTitle: 'dental' }),
        ], port);
        expect(result.createdProjectIds).toHaveLength(1);
        expect(port.addProject).toHaveBeenCalledTimes(1);
    });
});

describe('Process Inbox dependencies', () => {
    const pair = [{ id: 'a', title: 'Print the part' }, { id: 'b', title: 'Test the part' }, { id: 'c', title: 'Buy milk' }];
    const context = { now: NOW, projects: ['Aircraft'], areas: [], contexts: [] };
    const parse = (entries: unknown[]) => parseInboxProcessResponse(JSON.stringify({ items: entries, summary: '' }), pair, context);
    const filed = (extra: Record<string, unknown>) => ({ kind: 'next', project: 'Aircraft', ...extra });

    it('links two items filed into the same project', () => {
        const out = parse([filed({ id: 't1' }), filed({ id: 't2', after: 't1' })]);
        expect(out?.items.find((item) => item.taskId === 'b')?.blockedByTaskId).toBe('a');
    });

    it('drops links across destinations, unknown ids, self-links and loops', () => {
        const across = parse([filed({ id: 't1' }), { id: 't2', kind: 'next', project: 'Other', after: 't1' }]);
        expect(across?.items.find((item) => item.taskId === 'b')?.blockedByTaskId).toBeUndefined();
        const unknown = parse([filed({ id: 't1', after: 't9' })]);
        expect(unknown?.items[0].blockedByTaskId).toBeUndefined();
        const self = parse([filed({ id: 't1', after: 't1' })]);
        expect(self?.items[0].blockedByTaskId).toBeUndefined();
        const loop = parse([filed({ id: 't1', after: 't2' }), filed({ id: 't2', after: 't1' })]);
        expect(loop?.items.filter((item) => item.blockedByTaskId)).toHaveLength(1);
    });

    it('sets the blocker when both are applied, undoes it, and skips it when one stays behind', async () => {
        const base = (id: string, title: string) => ({ id, title, status: 'inbox' as const, tags: [], contexts: [], createdAt: '', updatedAt: '' });
        const project = { id: 'p', title: 'Aircraft', status: 'active', color: '#fff', order: 0, tagIds: [], createdAt: '', updatedAt: '' } as Project;
        const makePort = () => {
            const tasks = [base('a', 'Print the part'), base('b', 'Test the part')] as Task[];
            const port = {
                getSnapshot: () => ({ tasks: tasks.map((t) => ({ ...t })), projects: [project], areas: [] as Area[] }),
                updateTask: async (id: string, updates: Partial<Task>) => {
                    const task = tasks.find((t) => t.id === id)!;
                    for (const [key, value] of Object.entries(updates)) {
                        if (value === undefined) delete (task as any)[key];
                        else (task as any)[key] = value;
                    }
                    return { success: true };
                },
                deleteTask: async () => ({ success: true }),
                addProject: async () => project,
                addArea: async () => null,
            };
            return { tasks, port };
        };
        const parsed = parse([filed({ id: 't1' }), filed({ id: 't2', after: 't1' })])!;
        const first = makePort();
        const result = await applyInboxProcessSuggestions(parsed.items, first.port as unknown as AssistantStorePort);
        expect(first.tasks.find((t) => t.id === 'b')?.blockedByTaskIds).toEqual(['a']);
        const log = new AssistantChangeLog();
        const entry = log.record('m', 'process_inbox', { label: 'x', undoOps: result.undoOps, changes: result.changes });
        await log.undo(entry.id, first.port as unknown as AssistantStorePort);
        expect(first.tasks.find((t) => t.id === 'b')).not.toHaveProperty('blockedByTaskIds');

        const second = makePort();
        await applyInboxProcessSuggestions(parsed.items.filter((item) => item.taskId === 'b'), second.port as unknown as AssistantStorePort);
        expect(second.tasks.find((t) => t.id === 'b')).not.toHaveProperty('blockedByTaskIds');
    });
});
