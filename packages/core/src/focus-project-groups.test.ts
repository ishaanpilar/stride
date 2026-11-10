import { describe, expect, it } from 'vitest';
import { buildFocusPools, deriveFocusTaskLists } from './focus-sections';
import { buildFocusProjectLayout } from './focus-project-groups';
import type { Area, Project, Section, Task } from './types';

const NOW = new Date('2026-11-08T10:00:00');
const iso = (value: string) => new Date(value).toISOString();
const CREATED = iso('2026-10-01T08:00:00');

const makeTask = (overrides: Partial<Task> & Pick<Task, 'id'>): Task => ({
    title: overrides.id,
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
});

const makeProject = (overrides: Partial<Project> & Pick<Project, 'id'>): Project => ({
    title: overrides.id,
    status: 'active',
    color: '#2563EB',
    order: 0,
    tagIds: [],
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
});

const makeArea = (id: string, order: number): Area => ({ id, name: id, color: '#123456', order, createdAt: CREATED, updatedAt: CREATED });

const ids = (tasks: readonly Task[]) => tasks.map((task) => task.id);

const derive = (tasks: Task[], projects: Project[], sections: Section[] = []) => {
    const pools = buildFocusPools({ tasks, visibleTasks: tasks, projects, criteria: undefined, now: NOW });
    const lists = deriveFocusTaskLists(pools, { now: NOW, projects, sections, sortBy: 'default', prioritiesEnabled: true });
    const lockedTasks = pools.active.filter((task) => task.status === 'next' && lists.sequentialBlockedIds.has(task.id));
    return { lists, lockedTasks };
};

const layoutFor = (tasks: Task[], projects: Project[], sections: Section[] = [], areas: Area[] = []) => {
    const { lists, lockedTasks } = derive(tasks, projects, sections);
    return buildFocusProjectLayout({ nextActions: lists.nextActions, allTasks: tasks, lockedTasks, projects, sections, areas, now: NOW });
};

describe('buildFocusProjectLayout: next action', () => {
    it("picks the project's next action by manual order, then priority, then due date", () => {
        const project = makeProject({ id: 'p' });
        const layout = layoutFor([
            makeTask({ id: 'later', projectId: 'p', order: 2 }),
            makeTask({ id: 'first', projectId: 'p', order: 0, priority: 'low' }),
            makeTask({ id: 'second', projectId: 'p', order: 1, priority: 'urgent' }),
        ], [project]);
        expect(layout.cards).toHaveLength(1);
        expect(layout.cards[0].nextAction.id).toBe('first');
        expect(ids(layout.cards[0].moreActions)).toEqual(['second', 'later']);
    });

    it('falls back to priority then due date when tasks have no manual order', () => {
        const layout = layoutFor([
            makeTask({ id: 'plain', projectId: 'p' }),
            makeTask({ id: 'due', projectId: 'p', dueDate: iso('2026-11-20T09:00:00') }),
            makeTask({ id: 'urgent', projectId: 'p', priority: 'urgent' }),
        ], [makeProject({ id: 'p' })]);
        expect(layout.cards[0].nextAction.id).toBe('urgent');
        expect(ids(layout.cards[0].moreActions)).toEqual(['due', 'plain']);
    });

    it('respects project section order before task order', () => {
        const sections: Section[] = [
            { id: 's2', projectId: 'p', title: 'B', order: 1, createdAt: CREATED, updatedAt: CREATED } as Section,
            { id: 's1', projectId: 'p', title: 'A', order: 0, createdAt: CREATED, updatedAt: CREATED } as Section,
        ];
        const layout = layoutFor([
            makeTask({ id: 'in-second', projectId: 'p', sectionId: 's2', order: 0 }),
            makeTask({ id: 'in-first', projectId: 'p', sectionId: 's1', order: 5 }),
        ], [makeProject({ id: 'p' })], sections);
        expect(layout.cards[0].nextAction.id).toBe('in-first');
    });

    it('never surfaces a sequential project\'s blocked tasks as next actions; holds them as locked', () => {
        const project = makeProject({ id: 'seq', isSequential: true });
        const layout = layoutFor([
            makeTask({ id: 'step-1', projectId: 'seq', order: 0 }),
            makeTask({ id: 'step-2', projectId: 'seq', order: 1 }),
            makeTask({ id: 'step-3', projectId: 'seq', order: 2 }),
        ], [project]);
        expect(layout.cards[0].nextAction.id).toBe('step-1');
        expect(layout.cards[0].moreActions).toEqual([]);
        expect(ids(layout.cards[0].lockedTasks)).toEqual(['step-2', 'step-3']);
    });

    it('skips a task already shown in Today\'s Focus or Today and keeps the card count honest', () => {
        const project = makeProject({ id: 'p' });
        const tasks = [
            makeTask({ id: 'starred', projectId: 'p', order: 0, isFocusedToday: true }),
            makeTask({ id: 'due-today', projectId: 'p', order: 1, dueDate: iso('2026-11-08T17:00:00') }),
            makeTask({ id: 'third', projectId: 'p', order: 2 }),
            makeTask({ id: 'fourth', projectId: 'p', order: 3 }),
        ];
        const layout = layoutFor(tasks, [project]);
        expect(layout.cards[0].nextAction.id).toBe('third');
        expect(ids(layout.cards[0].moreActions)).toEqual(['fourth']);
        expect(layout.cards[0].totalCount).toBe(4);
    });

    it('drops a project whose only open next actions are all in Today\'s Focus or Today', () => {
        const layout = layoutFor([
            makeTask({ id: 'starred', projectId: 'p', isFocusedToday: true }),
        ], [makeProject({ id: 'p' })]);
        expect(layout.cards).toEqual([]);
    });
});

describe('buildFocusProjectLayout: progress', () => {
    it('counts done against total for the project, ignoring deleted and reference tasks', () => {
        const tasks = [
            makeTask({ id: 'done-1', projectId: 'p', status: 'done' }),
            makeTask({ id: 'done-2', projectId: 'p', status: 'done' }),
            makeTask({ id: 'waiting', projectId: 'p', status: 'waiting' }),
            makeTask({ id: 'next', projectId: 'p' }),
            makeTask({ id: 'deleted', projectId: 'p', deletedAt: CREATED }),
            makeTask({ id: 'ref', projectId: 'p', status: 'reference' }),
        ];
        const layout = layoutFor(tasks, [makeProject({ id: 'p' })]);
        expect(layout.cards[0].doneCount).toBe(2);
        expect(layout.cards[0].totalCount).toBe(4);
    });

    it('counts projects and open loose tasks for the section header', () => {
        const nextActions = [
            makeTask({ id: 'p1-a', projectId: 'p1' }),
            makeTask({ id: 'p2-a', projectId: 'p2' }),
            makeTask({ id: 'loose-open' }),
            makeTask({ id: 'loose-done', status: 'done' }),
        ];
        const projects = [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })];
        const layout = buildFocusProjectLayout({ nextActions, allTasks: nextActions, projects, now: NOW });
        expect(layout.counts).toEqual({ projects: 2, looseTasks: 1 });
    });
});

describe('buildFocusProjectLayout: ticking through a card', () => {
    const project = makeProject({ id: 'p' });
    const a = makeTask({ id: 'a', projectId: 'p', order: 0, status: 'done' });
    const b = makeTask({ id: 'b', projectId: 'p', order: 1 });
    const tasks = [a, b];

    it('keeps the ticked row in its place while its sequence runs, with the next task behind it', () => {
        const layout = buildFocusProjectLayout({ nextActions: [a, b], allTasks: tasks, projects: [project], settledDoneIds: new Set(), now: NOW });
        expect(layout.cards[0].nextAction.id).toBe('a');
        expect(ids(layout.cards[0].moreActions)).toEqual(['b']);
        expect(layout.cards[0].doneCount).toBe(1);
    });

    it('lets the next task rise into the card once the sequence has finished', () => {
        const layout = buildFocusProjectLayout({ nextActions: [a, b], allTasks: tasks, projects: [project], settledDoneIds: new Set(['a']), now: NOW });
        expect(layout.cards[0].nextAction.id).toBe('b');
        expect(layout.cards[0].moreActions).toEqual([]);
        expect(layout.cards[0].doneCount).toBe(1);
    });

    it('removes the card after its last action finishes', () => {
        const layout = buildFocusProjectLayout({ nextActions: [a], allTasks: [a], projects: [project], settledDoneIds: new Set(['a']), now: NOW });
        expect(layout.cards).toEqual([]);
    });
});

describe('buildFocusProjectLayout: card order', () => {
    const order = (projects: Project[], tasks: Task[], manualProjectOrder = false) => (
        buildFocusProjectLayout({ nextActions: tasks, allTasks: tasks, projects, now: NOW, manualProjectOrder })
            .cards.map((card) => card.project.id)
    );

    it('puts overdue, then urgent or due today, then focused projects before manual order', () => {
        const projects = [
            makeProject({ id: 'plain', order: 0 }),
            makeProject({ id: 'focused', order: 1, isFocused: true }),
            makeProject({ id: 'urgent', order: 2 }),
            makeProject({ id: 'overdue', order: 3 }),
        ];
        const tasks = [
            makeTask({ id: 'p-t', projectId: 'plain' }),
            makeTask({ id: 'f-t', projectId: 'focused' }),
            makeTask({ id: 'u-t', projectId: 'urgent', priority: 'urgent' }),
            makeTask({ id: 'o-t', projectId: 'overdue', dueDate: iso('2026-11-01T09:00:00') }),
        ];
        expect(order(projects, tasks)).toEqual(['overdue', 'urgent', 'focused', 'plain']);
    });

    it('ignores urgency once the cards are in manual order, keeping project order within areas', () => {
        const projects = [
            makeProject({ id: 'a', order: 0 }),
            makeProject({ id: 'b', order: 1 }),
        ];
        const tasks = [
            makeTask({ id: 't-a', projectId: 'a' }),
            makeTask({ id: 't-b', projectId: 'b', priority: 'urgent' }),
        ];
        expect(order(projects, tasks)).toEqual(['b', 'a']);
        expect(order(projects, tasks, true)).toEqual(['a', 'b']);
    });

    it('leaves tasks of archived, parked or missing projects as loose rows', () => {
        const nextActions = [
            makeTask({ id: 'parked', projectId: 'someday-project' }),
            makeTask({ id: 'orphan', projectId: 'gone' }),
        ];
        const layout = buildFocusProjectLayout({
            nextActions,
            allTasks: nextActions,
            projects: [makeProject({ id: 'someday-project', status: 'someday' })],
            now: NOW,
        });
        expect(layout.cards).toEqual([]);
        expect(ids(layout.looseTasks)).toEqual(['parked', 'orphan']);
    });
});

describe('buildFocusProjectLayout: loose tasks', () => {
    const buildLoose = (tasks: Task[], areas: Area[]) => buildFocusProjectLayout({ nextActions: tasks, allTasks: tasks, projects: [], areas, now: NOW });

    it('stays flat with one area or none', () => {
        expect(buildLoose([makeTask({ id: 'x' }), makeTask({ id: 'y' })], []).looseGroups).toEqual([]);
        expect(buildLoose([makeTask({ id: 'x', areaId: 'work' })], [makeArea('work', 0)]).looseGroups).toEqual([]);
    });

    it('groups by area in area order, no-area last, when more than one is present', () => {
        const layout = buildLoose([
            makeTask({ id: 'none-1' }),
            makeTask({ id: 'home-1', areaId: 'home' }),
            makeTask({ id: 'work-1', areaId: 'work' }),
        ], [makeArea('home', 1), makeArea('work', 0)]);
        expect(layout.looseGroups.map((group) => group.areaId)).toEqual(['work', 'home', null]);
        expect(ids(layout.looseGroups[2].tasks)).toEqual(['none-1']);
    });
});
