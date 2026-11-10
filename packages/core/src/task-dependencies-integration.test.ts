import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDailyBriefingInput } from './ai/daily-briefing';
import { buildFocusPools, deriveFocusTaskLists } from './focus-sections';
import { selectMenuBarPanelSections, selectMenuBarPanelView } from './menubar-panel';
import { getCalendarPlanningCandidates } from './task-utils';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { normalizeTaskUpdate } from './store-helpers';
import { normalizeTaskForContentComparison } from './sync-signatures';
import { normalizeTaskForSyncMerge } from './sync-normalization';
import { mergeAppData } from './sync';
import { TASK_SQLITE_COLUMNS, taskFromSqliteRow, taskToSqliteRow } from './task-sync-schema';
import type { StorageAdapter } from './storage';
import type { AppData, Task } from './types';

const NOW = new Date(2026, 10, 8, 10, 0, 0);
const ISO = NOW.toISOString();
const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: id.toUpperCase(), status: 'next', tags: [], contexts: [], createdAt: ISO, updatedAt: ISO, ...extra,
}) as Task;
const ids = (list: Task[]) => list.map((t) => t.id).sort();

const blocker = task('blocker');
const blocked = task('blocked', { blockedByTaskIds: ['blocker'] });
const starredBlocked = task('starred', { blockedByTaskIds: ['blocker'], isFocusedToday: true });
const freeTask = task('free');
const doneBlocker = task('done-blocker', { status: 'done' });
const unblockedByDone = task('freed', { blockedByTaskIds: ['done-blocker'] });

const focusLists = (allTasks: Task[], visibleTasks: Task[] = allTasks) => deriveFocusTaskLists(
    buildFocusPools({ tasks: visibleTasks.filter((t) => t.isFocusedToday), allTasks, visibleTasks, projects: [], criteria: undefined, now: NOW }),
    { now: NOW, projects: [], sections: [], sortBy: 'default', prioritiesEnabled: true },
);

describe('hiding blocked tasks', () => {
    const allTasks = [blocker, blocked, starredBlocked, freeTask, doneBlocker, unblockedByDone];

    it('removes blocked tasks from Focus sections but keeps a starred one', () => {
        const lists = focusLists(allTasks);
        expect(ids(lists.nextActions)).toEqual(['blocker', 'free', 'freed']);
        expect(ids(lists.focusedTasks)).toEqual(['starred']);
    });

    it('treats a blocker hidden by an area filter as still blocking', () => {
        const lists = focusLists(allTasks, [blocked, freeTask]);
        expect(ids(lists.nextActions)).toEqual(['free']);
    });

    it('hides blocked tasks from review-due and upcoming sections', () => {
        const reviewBlocked = task('review', { status: 'waiting', reviewAt: ISO, blockedByTaskIds: ['blocker'] });
        const lists = focusLists([blocker, reviewBlocked]);
        expect(ids(lists.reviewDue)).toEqual([]);
    });

    it('hides blocked tasks from the menu bar but keeps a starred one', () => {
        const sections = selectMenuBarPanelSections(allTasks, { now: NOW });
        expect(ids(sections.today)).toEqual(['starred']);
        expect(ids(sections.nextUp)).toEqual(['blocker', 'free', 'freed']);
        const view = selectMenuBarPanelView(allTasks, { now: NOW });
        expect(view.now.map((t) => t.id)).toEqual(['starred']);
        const allIds = view.all.flatMap((group) => group.tasks.map((t) => t.id));
        expect(allIds).not.toContain('blocked');
        expect(allIds).toContain('free');
    });

    it('keeps blocked tasks out of the morning briefing, even when due', () => {
        const dueBlocked = task('due-blocked', { dueDate: ISO, blockedByTaskIds: ['blocker'] });
        const input = buildDailyBriefingInput([blocker, dueBlocked, starredBlocked], [], NOW);
        const everyId = Object.values(input).flatMap((bucket) => (Array.isArray(bucket) ? bucket.map((t) => t.id) : []));
        expect(everyId).toContain('blocker');
        expect(everyId).not.toContain('due-blocked');
        expect(everyId).not.toContain('starred');
    });

    it('keeps blocked tasks out of calendar planning candidates', () => {
        expect(ids(getCalendarPlanningCandidates([blocker, blocked], { now: NOW }))).toEqual(['blocker']);
    });

    it('releases a task once its blocker is done', () => {
        const lists = focusLists([{ ...blocker, status: 'done' }, blocked]);
        expect(ids(lists.nextActions)).toEqual(['blocked']);
    });
});

describe('sync and storage', () => {
    it('round-trips through SQLite rows and keeps plain tasks absent', () => {
        const row = taskToSqliteRow(task('b', { blockedByTaskIds: ['a'] }));
        expect(row[TASK_SQLITE_COLUMNS.indexOf('blockedByTaskIds')]).toBe('["a"]');
        const record: Record<string, unknown> = {};
        TASK_SQLITE_COLUMNS.forEach((column, index) => { record[column] = row[index]; });
        expect(taskFromSqliteRow(record).blockedByTaskIds).toEqual(['a']);

        const plain = taskToSqliteRow(task('p'));
        expect(plain[TASK_SQLITE_COLUMNS.indexOf('blockedByTaskIds')]).toBeNull();
        const plainRecord: Record<string, unknown> = {};
        TASK_SQLITE_COLUMNS.forEach((column, index) => { plainRecord[column] = plain[index]; });
        expect(taskFromSqliteRow(plainRecord)).not.toHaveProperty('blockedByTaskIds');
    });

    it('normalizes merge input and never writes empty arrays', () => {
        const merged = normalizeTaskForSyncMerge(task('b', { blockedByTaskIds: [] }), ISO);
        expect(merged).not.toHaveProperty('blockedByTaskIds');
        const cleaned = normalizeTaskForSyncMerge(task('b', { blockedByTaskIds: ['a', 'a', 'b'] }), ISO);
        expect(cleaned.blockedByTaskIds).toEqual(['a']);
    });

    it('leaves a plain task byte-identical through merge normalization', () => {
        const plain = task('p');
        expect(JSON.stringify(normalizeTaskForSyncMerge(plain, ISO))).not.toContain('blockedByTaskIds');
    });

    it('treats a changed blocker list as a content change', () => {
        expect(normalizeTaskForContentComparison(task('b', { blockedByTaskIds: ['a'] })))
            .not.toEqual(normalizeTaskForContentComparison(task('b')));
    });

    it('merges by the newest revision like other content fields', () => {
        const base = (tasks: Task[]): AppData => ({ tasks, projects: [], sections: [], areas: [], people: [], settings: {} });
        const older = task('b', { rev: 1, updatedAt: '2026-11-01T00:00:00.000Z' });
        const newer = task('b', { rev: 2, updatedAt: '2026-11-02T00:00:00.000Z', blockedByTaskIds: ['a'] });
        expect(mergeAppData(base([older]), base([newer])).tasks[0].blockedByTaskIds).toEqual(['a']);
    });
});

describe('store rules', () => {
    let saveData: ReturnType<typeof vi.fn>;
    const seed = (tasks: Task[]) => useTaskStore.setState({
        tasks, _allTasks: tasks, _tasksById: new Map(tasks.map((t) => [t.id, t])), settings: { deviceId: 'device-a' },
    });

    beforeEach(() => {
        saveData = vi.fn().mockResolvedValue(undefined);
        const storage: StorageAdapter = {
            getData: vi.fn().mockResolvedValue({ tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} }),
            saveData,
        };
        setStorageAdapter(storage);
        useTaskStore.setState({
            tasks: [], projects: [], sections: [], areas: [], people: [], settings: { deviceId: 'device-a' },
            isLoading: false, error: null, persistenceFailure: null,
            _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            _tasksById: new Map(), _projectsById: new Map(), _sectionsById: new Map(), _areasById: new Map(), _peopleById: new Map(),
            lastDataChangeAt: 0,
        });
    });

    afterEach(async () => {
        await flushPendingSave();
        await resetForTests();
    });

    it('refuses a cycle with a clear message', async () => {
        seed([task('a', { blockedByTaskIds: ['b'] }), task('b')]);
        const result = await useTaskStore.getState().updateTask('b', { blockedByTaskIds: ['a'] });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/block each other/);
    });

    it('normalizes updates and clearing leaves no empty array', async () => {
        seed([task('a'), task('b', { blockedByTaskIds: ['a'] })]);
        await useTaskStore.getState().updateTask('b', { blockedByTaskIds: [] });
        expect(useTaskStore.getState()._tasksById.get('b')?.blockedByTaskIds).toBeUndefined();
        expect(normalizeTaskUpdate(task('p'), { blockedByTaskIds: [] })).not.toHaveProperty('blockedByTaskIds');
    });

    it('adds tasks with blockers and never an empty list', async () => {
        const plain = await useTaskStore.getState().addTask('plain', {});
        const plainTask = useTaskStore.getState()._tasksById.get(plain.id as string)!;
        expect(plainTask).not.toHaveProperty('blockedByTaskIds');
        const withBlocker = await useTaskStore.getState().addTask('blocked', { blockedByTaskIds: [' a ', 'a'] });
        expect(useTaskStore.getState()._tasksById.get(withBlocker.id as string)?.blockedByTaskIds).toEqual(['a']);
    });

    it('keeps references through Trash and removes them on purge', async () => {
        seed([task('a'), task('b', { blockedByTaskIds: ['a'] })]);
        await useTaskStore.getState().deleteTask('a');
        expect(useTaskStore.getState()._tasksById.get('b')?.blockedByTaskIds).toEqual(['a']);
        await useTaskStore.getState().restoreTask('a');
        await useTaskStore.getState().deleteTask('a');
        await useTaskStore.getState().purgeTask('a');
        expect(useTaskStore.getState()._tasksById.get('b')?.blockedByTaskIds).toBeUndefined();
    });

    it('remaps blockers when a project is duplicated', async () => {
        const project = { id: 'p1', title: 'P', status: 'active', color: '#000', order: 0, tagIds: [], createdAt: ISO, updatedAt: ISO } as AppData['projects'][number];
        useTaskStore.setState({ _allProjects: [project], projects: [project], _projectsById: new Map([['p1', project]]) });
        seed([task('a', { projectId: 'p1' }), task('b', { projectId: 'p1', blockedByTaskIds: ['a', 'outside'] }), task('outside')]);
        await useTaskStore.getState().duplicateProject('p1');
        const copies = useTaskStore.getState()._allTasks.filter((t) => t.projectId && t.projectId !== 'p1');
        const copyA = copies.find((t) => t.title === 'A')!;
        const copyB = copies.find((t) => t.title === 'B')!;
        expect(copyB.blockedByTaskIds).toEqual([copyA.id, 'outside']);
    });
});
