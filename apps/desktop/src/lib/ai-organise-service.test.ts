import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPendingSave, useTaskStore, type Project, type ProjectOrderProposal, type Task, type TaskGroupingGroup } from '@stride/core';

import {
    LOOSE_GROUPING_DISMISSED_KEY,
    applyLooseGrouping,
    applyProjectOrderSelection,
    dismissLooseGrouping,
    readLooseGroupingDismissedCount,
    undoAiOrganise,
} from './ai-organise-service';
import { assistantChangeLog } from './assistant-service';
import { generateProjectOrder } from './ai-organise-generate';

const createAIProvider = vi.hoisted(() => vi.fn());
vi.mock('@stride/core', async (importOriginal) => ({ ...(await importOriginal<typeof import('@stride/core')>()), createAIProvider }));
vi.mock('./ai-config', () => ({ loadAIKey: vi.fn().mockResolvedValue('key'), buildAIConfig: vi.fn().mockResolvedValue({ provider: 'openai', apiKey: 'key', model: 'm' }) }));
vi.mock('./report-error', () => ({ reportError: vi.fn() }));

const stamp = '2026-11-08T09:00:00.000Z';
const task = (id: string, overrides: Partial<Task> = {}): Task => ({ id, title: `Task ${id}`, status: 'next', tags: [], contexts: [], createdAt: stamp, updatedAt: stamp, ...overrides });
const project = (id: string, overrides: Partial<Project> = {}): Project => ({ id, title: `Project ${id}`, status: 'active', color: '#000', order: 0, tagIds: [], createdAt: stamp, updatedAt: stamp, ...overrides } as Project);

const seed = (tasks: Task[], projects: Project[]) => useTaskStore.setState({
    tasks, _allTasks: tasks, _tasksById: new Map(tasks.map((t) => [t.id, t])),
    projects, _allProjects: projects, _projectsById: new Map(projects.map((p) => [p.id, p])),
    areas: [], _allAreas: [], settings: { deviceId: 'test', ai: { enabled: true, provider: 'openai' } },
} as never);

const read = (id: string) => useTaskStore.getState()._allTasks.find((t) => t.id === id);
const readProject = (id: string) => useTaskStore.getState()._allProjects.find((p) => p.id === id);

describe('applying AI organising through the real store', () => {
    beforeEach(() => {
        window.localStorage.clear();
        createAIProvider.mockReset();
    });

    it('applies order, blockers and Next action only as one change, and one undo restores them', async () => {
        seed([
            task('a', { projectId: 'p', order: 1, orderNum: 1 }),
            task('b', { projectId: 'p', order: 2, orderNum: 2 }),
            task('c', { projectId: 'p', order: 3, orderNum: 3, blockedByTaskIds: ['x'] }),
            task('x'),
        ], [project('p', { isSequential: false })]);
        const before = assistantChangeLog.list().length;
        const proposal: ProjectOrderProposal = {
            projectId: 'p', order: ['c', 'b', 'a'], recommendNextActionOnly: true, independent: false, orderChanged: true, summary: '', source: 'ai',
            dependencies: [{ taskId: 'a', blockerId: 'c', reason: 'c first' }],
        };
        const result = await applyProjectOrderSelection(proposal, { applyOrder: true, dependencies: proposal.dependencies, applyNextActionOnly: true }, 'Ordered it');
        await flushPendingSave();

        expect((read('c')?.order ?? 99) < (read('b')?.order ?? 0)).toBe(true);
        expect((read('b')?.order ?? 99) < (read('a')?.order ?? 0)).toBe(true);
        expect(read('a')?.blockedByTaskIds).toEqual(['c']);
        expect(readProject('p')?.isSequential).toBe(true);
        expect(assistantChangeLog.list().length).toBe(before + 1);
        expect(result.changeId).toBeTruthy();

        await expect(undoAiOrganise(result.changeId as string)).resolves.toBe(true);
        await flushPendingSave();
        expect(read('a')).toMatchObject({ order: 1, orderNum: 1 });
        expect(read('a')?.blockedByTaskIds).toBeUndefined();
        expect(read('b')).toMatchObject({ order: 2 });
        expect(read('c')).toMatchObject({ order: 3, blockedByTaskIds: ['x'] });
        expect(readProject('p')?.isSequential).toBe(false);
    });

    it('creates a Next action only project, moves tasks, and one undo restores everything', async () => {
        seed([task('hair', { areaId: undefined }), task('pack')], []);
        const groups: TaskGroupingGroup[] = [{ key: 'g1', title: 'Goa trip', existing: false, taskIds: ['hair', 'pack'] }];
        const result = await applyLooseGrouping(groups, 'Grouped');
        await flushPendingSave();
        const created = useTaskStore.getState()._allProjects.find((p) => p.title === 'Goa trip');
        expect(created?.isSequential).toBe(true);
        expect(read('hair')?.projectId).toBe(created?.id);

        await expect(undoAiOrganise(result.changeId as string)).resolves.toBe(true);
        await flushPendingSave();
        expect(read('hair')?.projectId).toBeUndefined();
        expect(read('pack')?.projectId).toBeUndefined();
        expect(read('hair')?.deletedAt).toBeUndefined();
        expect(useTaskStore.getState()._allProjects.find((p) => p.title === 'Goa trip')?.deletedAt).toBeDefined();
    });

    it('asks a mocked provider once and falls back calmly when it fails or AI is off', async () => {
        seed([task('a', { projectId: 'p' }), task('b', { projectId: 'p' })], [project('p')]);
        createAIProvider.mockReturnValue({ generateText: vi.fn().mockResolvedValue(JSON.stringify({ order: ['t2', 't1'], dependencies: [] })) });
        await expect(generateProjectOrder('p')).resolves.toMatchObject({ status: 'ok', proposal: { independent: true, order: ['b', 'a'] } });

        createAIProvider.mockReturnValue({ generateText: vi.fn().mockRejectedValue(new Error('down')) });
        await expect(generateProjectOrder('p')).resolves.toEqual({ status: 'unavailable', reason: 'failed' });

        useTaskStore.setState({ settings: { deviceId: 'test' } } as never);
        await expect(generateProjectOrder('p')).resolves.toEqual({ status: 'unavailable', reason: 'disabled' });
    });
});

describe('loose grouping dismissal', () => {
    beforeEach(() => window.localStorage.clear());

    it('remembers the count it was dismissed at, and tolerates junk', () => {
        expect(readLooseGroupingDismissedCount()).toBeNull();
        dismissLooseGrouping(7);
        expect(readLooseGroupingDismissedCount()).toBe(7);
        window.localStorage.setItem(LOOSE_GROUPING_DISMISSED_KEY, 'nonsense');
        expect(readLooseGroupingDismissedCount()).toBeNull();
    });
});
