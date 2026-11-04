import { describe, expect, it } from 'vitest';

import { countMenuBarPanelTasks, selectMenuBarPanelSections, selectMenuBarPanelTabs } from './menubar-panel';
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

describe('selectMenuBarPanelTabs', () => {
    const tabs = (list: Task[]) => selectMenuBarPanelTabs(list, { now: NOW });

    it('groups upcoming tasks by day within the next seven days', () => {
        const result = tabs([
            task('d1b', { dueDate: at(1, 15) }),
            task('d1a', { dueDate: at(1, 9) }),
            task('d3', { startTime: at(3, 10) }),
            task('d7', { dueDate: at(7, 12) }),
            task('d8', { dueDate: at(8, 12) }),
            task('today', { dueDate: at(0, 15) }),
        ]);
        expect(result.upcoming.map((d) => d.key)).toEqual(['2026-11-05', '2026-11-07', '2026-11-11']);
        expect(ids(result.upcoming[0].tasks)).toEqual(['d1a', 'd1b']);
        expect(result.counts.upcoming).toBe(4);
    });

    it('collects inbox items newest first and all next actions', () => {
        const result = tabs([
            task('old', { status: 'inbox', createdAt: at(-5) }),
            task('new', { status: 'inbox', createdAt: at(-1) }),
            task('n1'),
            task('n2', { dueDate: at(0, 15) }),
            task('w', { status: 'waiting' }),
            task('gone', { status: 'inbox', deletedAt: at(-1) }),
        ]);
        expect(ids(result.inbox)).toEqual(['new', 'old']);
        expect(ids(result.next).sort()).toEqual(['n1', 'n2']);
        expect(result.counts).toMatchObject({ inbox: 2, next: 2, today: 1 });
    });

    it('counts overdue plus today for the Today tab', () => {
        const result = tabs([task('late', { dueDate: at(-1) }), task('now', { dueDate: at(0, 15) })]);
        expect(result.counts.today).toBe(2);
        expect(ids(result.overdue)).toEqual(['late']);
    });
});
