import { describe, expect, it } from 'vitest';

import {
    applyMenuBarFocusOrder,
    countMenuBarPanelTasks,
    getMenuBarReorderIds,
    isMenuBarTaskReorderable,
    selectMenuBarPanelSections,
    filterMenuBarAllGroups,
    selectMenuBarPanelView,
} from './menubar-panel';
import type { Project, Task } from './types';

const NOW = new Date(2026, 10, 4, 10, 0, 0);
const at = (offset: number, h = 12) => new Date(2026, 10, 4 + offset, h, 0, 0).toISOString();

const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: `Task ${id}`, status: 'next', tags: [], contexts: [],
    createdAt: at(-10), updatedAt: at(-10), ...extra,
});

const ids = (list: Task[]) => list.map((t) => t.id);

describe('selectMenuBarPanelSections', () => {
    it('splits overdue, today and next up without duplicates', () => {
        const sections = selectMenuBarPanelSections([
            task('late', { dueDate: at(-2) }),
            task('due-today', { dueDate: at(0, 15) }),
            task('starts-today', { startTime: at(0, 9) }),
            task('focused', { isFocusedToday: true }),
            task('plain'),
            task('future', { dueDate: at(5) }),
        ], { now: NOW });
        expect(ids(sections.overdue)).toEqual(['late']);
        expect(ids(sections.today).sort()).toEqual(['due-today', 'focused', 'starts-today']);
        expect(ids(sections.nextUp).sort()).toEqual(['future', 'plain']);
    });

    it('sorts urgent priority first, then by time', () => {
        const sections = selectMenuBarPanelSections([
            task('b', { dueDate: at(0, 11) }),
            task('a', { dueDate: at(0, 16), priority: 'urgent' }),
            task('c', { dueDate: at(0, 10) }),
        ], { now: NOW });
        expect(ids(sections.today)).toEqual(['a', 'c', 'b']);
    });

    it('skips done, deleted, someday, reference and untimed inbox tasks', () => {
        const sections = selectMenuBarPanelSections([
            task('done', { status: 'done', dueDate: at(0) }),
            task('trash', { dueDate: at(0), deletedAt: at(-1) }),
            task('someday', { status: 'someday', dueDate: at(0) }),
            task('ref', { status: 'reference', dueDate: at(0) }),
            task('inbox'  , { status: 'inbox' }),
            task('inbox-due', { status: 'inbox', dueDate: at(0) }),
        ], { now: NOW });
        expect(ids(sections.overdue)).toEqual([]);
        expect(ids(sections.today)).toEqual(['inbox-due']);
        expect(sections.nextUp).toEqual([]);
    });

    it('hides tasks in inactive projects and future-start next actions', () => {
        const projects = [{ id: 'p1', title: 'Paused', status: 'someday' } as Project];
        const sections = selectMenuBarPanelSections([
            task('in-paused', { projectId: 'p1', dueDate: at(0) }),
            task('deferred', { startTime: at(3) }),
        ], { now: NOW, projects });
        expect(sections.today).toEqual([]);
        expect(sections.nextUp).toEqual([]);
    });

    it('limits next up', () => {
        const many = Array.from({ length: 9 }, (_, i) => task(`n${i}`));
        expect(selectMenuBarPanelSections(many, { now: NOW }).nextUp).toHaveLength(5);
        expect(selectMenuBarPanelSections(many, { now: NOW, nextLimit: 2 }).nextUp).toHaveLength(2);
    });
});

describe('countMenuBarPanelTasks', () => {
    it('counts overdue plus today only', () => {
        expect(countMenuBarPanelTasks([
            task('late', { dueDate: at(-1) }),
            task('today', { dueDate: at(0) }),
            task('next'),
        ], { now: NOW })).toBe(2);
    });
});

describe('selectMenuBarPanelView', () => {
    const view = (list: Task[], manualToday = false) => selectMenuBarPanelView(list, { now: NOW, manualOrder: { today: manualToday } });

    it('puts overdue, focus and due/starting today in one Now list, overdue first', () => {
        const result = view([
            task('today', { dueDate: at(0, 15) }),
            task('focus', { isFocusedToday: true }),
            task('late', { dueDate: at(-2) }),
            task('starts', { startTime: at(0, 9) }),
            task('plain'),
        ]);
        expect(ids(result.now)).toEqual(['late', 'focus', 'starts', 'today']);
        expect(ids(result.nowParts.overdue)).toEqual(['late']);
        expect(ids(result.nowParts.focus)).toEqual(['focus']);
        expect(result.counts.now).toBe(4);
    });

    it('keeps a focused overdue task with the focus rows, in Focus order', () => {
        const result = view([
            task('f2', { isFocusedToday: true, focusOrder: 2000 }),
            task('f-late', { dueDate: at(-1), isFocusedToday: true, focusOrder: 1000 }),
            task('late', { dueDate: at(-3) }),
        ]);
        expect(ids(result.now)).toEqual(['late', 'f-late', 'f2']);
    });

    it('groups every other open task Tomorrow / This week / Later / No date, priority first', () => {
        const result = view([
            task('t-low', { dueDate: at(1, 9), priority: 'low' }),
            task('t-urgent', { dueDate: at(1, 15), priority: 'urgent' }),
            task('week', { startTime: at(4, 10) }),
            task('week-edge', { dueDate: at(7, 20) }),
            task('later', { dueDate: at(20) }),
            task('none-high', { priority: 'high' }),
            task('none'),
            task('someday', { status: 'someday' }),
            task('today', { dueDate: at(0, 15) }),
            task('inbox', { status: 'inbox' }),
            task('waiting', { status: 'waiting' }),
            task('done', { status: 'done' }),
            task('gone', { deletedAt: at(-1) }),
        ]);
        expect(result.all.map((group) => group.key)).toEqual(['tomorrow', 'week', 'later', 'none']);
        expect(ids(result.all[0].tasks)).toEqual(['t-urgent', 't-low']);
        expect(ids(result.all[1].tasks)).toEqual(['week', 'week-edge']);
        expect(ids(result.all[2].tasks)).toEqual(['later']);
        expect(ids(result.all[3].tasks)).toEqual(['none-high', 'none', 'someday']);
        expect(result.counts.all).toBe(8);
        expect(result.inboxCount).toBe(1);
    });

    it('leaves out tasks of inactive projects and drops empty groups', () => {
        const projects = [{ id: 'p', title: 'Old', status: 'archived', color: '#000', order: 0, tagIds: [], createdAt: at(-9), updatedAt: at(-9) } as Project];
        const result = selectMenuBarPanelView([task('x', { projectId: 'p' }), task('y', { dueDate: at(30) })], { now: NOW, projects });
        expect(result.all.map((group) => group.key)).toEqual(['later']);
    });

    it('filters All tasks by title, project, area, context and tag', () => {
        const projects = [{ id: 'p', title: 'Garden', status: 'active', color: '#000', order: 0, tagIds: [], createdAt: at(-9), updatedAt: at(-9) } as Project];
        const result = selectMenuBarPanelView([
            task('a', { title: 'Mow the lawn', projectId: 'p' }),
            task('b', { title: 'Call mum', contexts: ['@phone'], dueDate: at(1) }),
            task('c', { title: 'Taxes', tags: ['#money'], areaId: 'ar' }),
        ], { now: NOW, projects });
        const lookup = { projects, areas: [{ id: 'ar', name: 'Admin' }] };
        expect(filterMenuBarAllGroups(result.all, 'garden', lookup).flatMap((group) => ids(group.tasks))).toEqual(['a']);
        expect(filterMenuBarAllGroups(result.all, 'PHONE', lookup).map((group) => group.key)).toEqual(['tomorrow']);
        expect(filterMenuBarAllGroups(result.all, 'admin', lookup).flatMap((group) => ids(group.tasks))).toEqual(['c']);
        expect(filterMenuBarAllGroups(result.all, '  ', lookup)).toHaveLength(result.all.length);
        expect(filterMenuBarAllGroups(result.all, 'zzz', lookup)).toEqual([]);
    });
});

describe('menu bar manual order', () => {
    const tabs = (list: Task[]) => selectMenuBarPanelView(list, { now: NOW });

    it('orders Today by focusOrder first, then the urgency/due-time order', () => {
        const result = tabs([
            task('plain', { dueDate: at(0, 9) }),
            task('f2', { dueDate: at(0, 15), isFocusedToday: true, focusOrder: 2000 }),
            task('f1', { isFocusedToday: true, focusOrder: 1000 }),
            task('f3', { dueDate: at(0, 8), isFocusedToday: true }),
        ]);
        expect(ids(result.now)).toEqual(['f1', 'f2', 'f3', 'plain']);
    });

    it('ignores a stale focusOrder on a task that is no longer focused today', () => {
        const result = tabs([
            task('a', { dueDate: at(0, 9) }),
            task('stale', { dueDate: at(0, 15), focusOrder: 1 }),
        ]);
        expect(ids(result.now)).toEqual(['a', 'stale']);
    });

    it('keeps the incoming order when nothing has a manual focus order', () => {
        const list = [task('a'), task('b')];
        expect(applyMenuBarFocusOrder(list, NOW)).toBe(list);
    });

    it('orders the other Today rows by boardOrder in manual order, after the focused rows', () => {
        const list = [
            task('early', { dueDate: at(0, 8) }),
            task('late', { dueDate: at(0, 16), boardOrder: 10 }),
            task('f', { isFocusedToday: true, focusOrder: 0 }),
            task('overdue-a', { dueDate: at(-2) }),
            task('overdue-b', { dueDate: at(-1), boardOrder: 5 }),
        ];
        expect(ids(tabs(list).now)).toEqual(['overdue-a', 'overdue-b', 'f', 'early', 'late']);
        const manual = selectMenuBarPanelView(list, { now: NOW, manualOrder: { today: true } });
        expect(ids(manual.nowParts.today)).toEqual(['late', 'early']);
        expect(ids(manual.nowParts.overdue)).toEqual(['overdue-b', 'overdue-a']);
        expect(ids(manual.now)).toEqual(['overdue-b', 'overdue-a', 'f', 'late', 'early']);
    });

    it('limits reordering to open tasks and splits Today into focused and other rows', () => {
        const focused = task('f', { isFocusedToday: true });
        const plain = task('p', { dueDate: at(0) });
        const done = task('d', { status: 'done', isFocusedToday: true });
        expect(isMenuBarTaskReorderable(focused, 'focus', NOW)).toBe(true);
        expect(isMenuBarTaskReorderable(plain, 'focus', NOW)).toBe(false);
        expect(isMenuBarTaskReorderable(plain, 'board', NOW)).toBe(true);
        expect(isMenuBarTaskReorderable(done, 'board', NOW)).toBe(false);
        expect(getMenuBarReorderIds([focused, plain, done], 'focus', NOW)).toEqual(['f']);
        expect(getMenuBarReorderIds([focused, plain, done], 'board', NOW)).toEqual(['f', 'p']);
        expect(isMenuBarTaskReorderable(plain, 'today', NOW)).toBe(true);
        expect(isMenuBarTaskReorderable(focused, 'today', NOW)).toBe(false);
        expect(getMenuBarReorderIds([focused, plain, done], 'today', NOW)).toEqual(['p']);
    });
});

describe('sequential blocking in the menu bar panel', () => {
    const project = { id: 'seq', title: 'Sequential', status: 'active', isSequential: true } as Project;
    const seqTask = (id: string, order: number, extra: Partial<Task> = {}) => task(id, { projectId: 'seq', order, ...extra });

    it('hides blocked steps from All tasks, showing only the next one', () => {
        const view = selectMenuBarPanelView([seqTask('step-1', 0), seqTask('step-2', 1), seqTask('step-3', 2)], { now: NOW, projects: [project] });
        expect(view.all.flatMap((group) => ids(group.tasks))).toEqual(['step-1']);
        expect(view.counts.all).toBe(1);
    });

    it('shows the current step in Now the way Focus does: a due-today step, or a star ahead of it', () => {
        const dueStep = selectMenuBarPanelView([
            seqTask('step-1', 0),
            seqTask('due', 1, { dueDate: at(0, 18) }),
            seqTask('later', 2),
        ], { now: NOW, projects: [project] });
        expect(ids(dueStep.now)).toEqual(['due']);
        expect(dueStep.all).toEqual([]);

        const starred = selectMenuBarPanelView([
            seqTask('step-1', 0),
            seqTask('due', 1, { dueDate: at(0, 18) }),
            seqTask('starred', 3, { isFocusedToday: true }),
        ], { now: NOW, projects: [project] });
        expect(ids(starred.now)).toEqual(['starred']);
    });
});
