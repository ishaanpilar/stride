import { describe, expect, it } from 'vitest';
import { executeConfirmed, runToolCall } from './agent';
import { AssistantChangeLog } from './change-log';
import { ASSISTANT_TOOLS, getToolDefinitions } from './registry';
import { groupDuplicates, titleSimilarity } from './tools-extra';
import { createFakePort } from './testing';

const NOW = new Date(2026, 10, 4, 9, 30, 0);
const exec = (port: any, log: AssistantChangeLog, name: string, args: unknown) =>
    runToolCall({ name, rawArguments: JSON.stringify(args), tools: ASSISTANT_TOOLS, ctx: { port, now: NOW }, changeLog: log, messageId: 'm1' });

const setup = () => {
    const f = createFakePort({
        projects: [{ title: 'Garbled prj' }, { title: 'Website' }, { title: 'Old stuff' }],
        tasks: [
            { title: 'Call Ria', projectId: 'proj1-0000-0000-0000-000000000000', tags: ['#a'] },
            { title: 'Call Ria today', projectId: 'proj1-0000-0000-0000-000000000000' },
            { title: 'Write copy', projectId: 'proj2-0000-0000-0000-000000000000', tags: ['#a'] },
            { title: 'Buy milk' }, { title: 'Pay rent' },
        ],
    });
    return { ...f, log: new AssistantChangeLog() };
};
const pid = (n: number) => `proj${n}`;
const tid = (n: number) => `task${n}`;

describe('tool registry', () => {
    it('exposes the new tools with unique names', () => {
        const names = ASSISTANT_TOOLS.map((t) => t.name);
        expect(new Set(names).size).toBe(names.length);
        for (const n of ['update_project', 'delete_project', 'archive_project', 'merge_projects', 'list_areas', 'add_area', 'update_area', 'delete_area', 'list_tags', 'tag_tasks', 'rename_tag', 'delete_tag', 'bulk_update_tasks', 'find_duplicates', 'merge_tasks', 'archive_done_tasks', 'schedule_task', 'plan_day', 'set_recurrence', 'set_focus', 'get_overview', 'apply_plan']) expect(names).toContain(n);
        expect(getToolDefinitions().length).toBe(names.length);
    });
});

describe('projects', () => {
    it('renames a project and undo restores the title', async () => {
        const { port, projects, log } = setup();
        const r = await exec(port, log, 'update_project', { id: pid(1), title: 'Client work' });
        expect(r.ok).toBe(true);
        expect(projects[0].title).toBe('Client work');
        expect(log.list()[0].kind).toBe('project');
        await log.undo(log.list()[0].id, port);
        expect(projects[0].title).toBe('Garbled prj');
    });

    it('delete_project asks which task action, requires confirmation, and undo restores everything', async () => {
        const { port, projects, tasks, log } = setup();
        const noAction = await exec(port, log, 'delete_project', { id: pid(1) });
        expect(noAction.ok).toBe(false);
        expect(noAction.content).toContain('Ask the user');
        const gated = await exec(port, log, 'delete_project', { id: pid(1), taskAction: 'unassign' });
        expect(gated.pending).toBeTruthy();
        expect(projects[0].deletedAt).toBeUndefined();
        const done = await executeConfirmed(gated.pending!, { port, changeLog: log, now: NOW });
        expect(done.ok).toBe(true);
        expect(projects[0].deletedAt).toBeTruthy();
        expect(tasks[0].projectId).toBeUndefined();
        await log.undo(log.list()[0].id, port);
        expect(projects[0].deletedAt).toBeUndefined();
        expect(tasks[0].projectId).toBe('proj1-0000-0000-0000-000000000000');
    });

    it('archive_project requires confirmation', async () => {
        const { port, log } = setup();
        const r = await exec(port, log, 'archive_project', { id: pid(3) });
        expect(r.pending).toBeTruthy();
    });

    it('merge_projects needs confirmation, moves tasks and undo reverses it', async () => {
        const { port, projects, tasks, log } = setup();
        const gated = await exec(port, log, 'merge_projects', { sourceId: pid(1), targetId: pid(2) });
        expect(gated.pending).toBeTruthy();
        await executeConfirmed(gated.pending!, { port, changeLog: log, now: NOW });
        expect(tasks[0].projectId).toBe('proj2-0000-0000-0000-000000000000');
        expect(projects[0].deletedAt).toBeTruthy();
        await log.undo(log.list()[0].id, port);
        expect(tasks[0].projectId).toBe('proj1-0000-0000-0000-000000000000');
        expect(projects[0].deletedAt).toBeUndefined();
    });

    it('unknown project ids are rejected', async () => {
        const { port, log } = setup();
        expect((await exec(port, log, 'update_project', { id: 'nope', title: 'x' })).ok).toBe(false);
    });
});

describe('areas and tags', () => {
    it('adds, renames, deletes (confirmed) an area with undo', async () => {
        const { port, areas, log } = setup();
        expect((await exec(port, log, 'add_area', { name: 'Home' })).ok).toBe(true);
        expect(areas).toHaveLength(1);
        const id = areas[0].id;
        await exec(port, log, 'update_area', { id, name: 'House' });
        expect(areas[0].name).toBe('House');
        await log.undo(log.list()[1].id, port);
        expect(areas[0].name).toBe('Home');
        const gated = await exec(port, log, 'delete_area', { id });
        expect(gated.pending).toBeTruthy();
        expect(areas[0].deletedAt).toBeUndefined();
        await executeConfirmed(gated.pending!, { port, changeLog: log, now: NOW });
        expect(areas[0].deletedAt).toBeTruthy();
        await log.undo(log.list()[2].id, port);
        expect(areas[0].deletedAt).toBeUndefined();
    });

    it('renames a tag across tasks and undoes', async () => {
        const { port, tasks, log } = setup();
        const r = await exec(port, log, 'rename_tag', { from: 'a', to: 'b' });
        expect(r.ok).toBe(true);
        expect(tasks[0].tags).toEqual(['#b']);
        expect(tasks[2].tags).toEqual(['#b']);
        await log.undo(log.list()[0].id, port);
        expect(tasks[0].tags).toEqual(['#a']);
    });

    it('delete_tag needs confirmation', async () => {
        const { port, tasks, log } = setup();
        const r = await exec(port, log, 'delete_tag', { name: '#a' });
        expect(r.pending).toBeTruthy();
        expect(tasks[0].tags).toEqual(['#a']);
    });

    it('tag_tasks drops unknown ids', async () => {
        const { port, tasks, log } = setup();
        const r = await exec(port, log, 'tag_tasks', { ids: [tid(4), 'ghost-id'], add: ['x'] });
        expect(r.ok).toBe(true);
        expect(tasks[3].tags).toEqual(['#x']);
        expect(JSON.parse(r.content).dropped).toEqual(['ghost-id']);
        expect((await exec(port, log, 'tag_tasks', { ids: ['ghost'], add: ['x'] })).ok).toBe(false);
    });
});

describe('bulk, duplicates and merges', () => {
    it('bulk_update_tasks: one confirmation above the threshold, one entry, one undo', async () => {
        const { port, tasks, log } = setup();
        const ids = [tid(1), tid(2), tid(3), tid(4), tid(5), 'ghost'];
        const gated = await exec(port, log, 'bulk_update_tasks', { ids, priority: 'high' });
        expect(gated.pending).toBeTruthy();
        expect(gated.pending!.affected).toHaveLength(5);
        expect(tasks[0].priority).toBeUndefined();
        await executeConfirmed(gated.pending!, { port, changeLog: log, now: NOW });
        expect(log.list()).toHaveLength(1);
        expect(tasks.every((t) => t.priority === 'high')).toBe(true);
        await log.undo(log.list()[0].id, port);
        expect(tasks.every((t) => t.priority === undefined)).toBe(true);
    });

    it('bulk_update_tasks applies directly for 3 or fewer', async () => {
        const { port, tasks, log } = setup();
        const r = await exec(port, log, 'bulk_update_tasks', { ids: [tid(4), tid(5)], status: 'someday' });
        expect(r.ok).toBe(true);
        expect(tasks[3].status).toBe('someday');
    });

    it('find_duplicates groups similar titles', async () => {
        const { port, log } = setup();
        const r = await exec(port, log, 'find_duplicates', {});
        const groups = JSON.parse(r.content).groups;
        expect(groups).toHaveLength(1);
        expect(groups[0].map((t: any) => t.title).sort()).toEqual(['Call Ria', 'Call Ria today']);
        expect(titleSimilarity('Buy milk', 'Pay rent')).toBe(0);
        expect(groupDuplicates([{ id: '1', title: 'x' }])).toEqual([]);
    });

    it('merge_tasks needs confirmation, combines data and undo restores', async () => {
        const { port, tasks, log } = setup();
        tasks[1].description = 'extra notes';
        const gated = await exec(port, log, 'merge_tasks', { keepId: tid(1), removeId: tid(2) });
        expect(gated.pending).toBeTruthy();
        await executeConfirmed(gated.pending!, { port, changeLog: log, now: NOW });
        expect(tasks[1].deletedAt).toBeTruthy();
        expect(tasks[0].description).toContain('extra notes');
        await log.undo(log.list()[0].id, port);
        expect(tasks[1].deletedAt).toBeUndefined();
        expect(tasks[0].description).toBeUndefined();
    });

    it('archive_done_tasks archives and undoes', async () => {
        const { port, tasks, log } = setup();
        tasks[3].status = 'done';
        expect((await exec(port, log, 'archive_done_tasks', {})).ok).toBe(true);
        expect(tasks[3].status).toBe('archived');
        await log.undo(log.list()[0].id, port);
        expect(tasks[3].status).toBe('done');
    });
});

describe('time and awareness', () => {
    it('schedule_task refuses clashes and suggests a free slot, allowOverlap overrides', async () => {
        const { port, tasks, log } = setup();
        tasks[3].startTime = '2026-11-05T10:00';
        const clash = await exec(port, log, 'schedule_task', { id: tid(5), startTime: '2026-11-05T10:15' });
        expect(clash.ok).toBe(false);
        expect(clash.content).toContain('Next free slot');
        expect((await exec(port, log, 'schedule_task', { id: tid(5), startTime: '2026-11-05T11:00' })).ok).toBe(true);
        expect((await exec(port, log, 'schedule_task', { id: tid(1), startTime: '2026-11-05T10:15', allowOverlap: true })).ok).toBe(true);
    });

    it('plan_day proposes non-overlapping blocks without changing anything', async () => {
        const { port, tasks, log, calls } = setup();
        tasks[3].dueDate = '2026-11-04'; tasks[4].dueDate = '2026-11-04'; tasks[4].priority = 'urgent';
        const r = await exec(port, log, 'plan_day', { workStart: '10:00' });
        const data = JSON.parse(r.content);
        expect(data.proposed.length).toBeGreaterThanOrEqual(2);
        expect(data.proposed[0].title).toBe('Pay rent');
        expect(new Set(data.proposed.map((b: any) => b.start)).size).toBe(data.proposed.length);
        expect(calls).not.toContain('updateTask');
    });

    it('set_recurrence sets and clears', async () => {
        const { port, tasks, log } = setup();
        await exec(port, log, 'set_recurrence', { id: tid(4), rule: 'weekly', byDay: ['MO'] });
        expect(tasks[3].recurrence).toEqual({ rule: 'weekly', byDay: ['MO'] });
        await exec(port, log, 'set_recurrence', { id: tid(4), rule: 'none' });
        expect(tasks[3].recurrence).toBeUndefined();
    });

    it('set_focus enforces the cap and drops unknown ids', async () => {
        const { port, tasks, log } = setup();
        expect((await exec(port, log, 'set_focus', { ids: [tid(1), 'ghost'] })).ok).toBe(true);
        expect(tasks[0].isFocusedToday).toBe(true);
        expect((await exec(port, log, 'set_focus', { ids: [tid(1), tid(2), tid(3), tid(4), tid(5), 'x1234'] , replace: true })).ok).toBe(true);
    });

    it('get_overview reports stale tasks and projects with no next action', async () => {
        const { port, tasks, log } = setup();
        tasks[3].updatedAt = '2026-01-01T00:00:00.000Z';
        const data = JSON.parse((await exec(port, log, 'get_overview', {})).content);
        expect(data.totals.open).toBe(5);
        expect(data.stale.map((t: any) => t.title)).toContain('Buy milk');
        expect(data.projectsWithoutNextAction.map((p: any) => p.title)).toContain('Old stuff');
    });
});

describe('apply_plan (cleanup mode)', () => {
    it('needs ONE confirmation, runs all steps as ONE undo group, skips invalid steps', async () => {
        const { port, projects, tasks, log } = setup();
        const args = {
            summary: 'Rename 1, merge 1',
            steps: [
                { tool: 'update_project', args: { id: pid(1), title: 'Clients' } },
                { tool: 'merge_projects', args: { sourceId: pid(3), targetId: pid(2) } },
                { tool: 'update_project', args: { id: 'ghost', title: 'x' } },
                { tool: 'list_tasks', args: {} },
            ],
        };
        const gated = await exec(port, log, 'apply_plan', args);
        expect(gated.pending).toBeTruthy();
        expect(gated.pending!.summary).toContain('2 invalid steps will be skipped');
        expect(projects[0].title).toBe('Garbled prj');
        const done = await executeConfirmed(gated.pending!, { port, changeLog: log, now: NOW });
        expect(done.ok).toBe(true);
        expect(log.list()).toHaveLength(1);
        expect(log.list()[0].kind).toBe('plan');
        expect(log.list()[0].details).toHaveLength(2);
        expect(projects[0].title).toBe('Clients');
        expect(projects[2].deletedAt).toBeTruthy();
        await log.undo(log.list()[0].id, port);
        expect(projects[0].title).toBe('Garbled prj');
        expect(projects[2].deletedAt).toBeUndefined();
        expect(tasks).toHaveLength(5);
    });

    it('rejects a plan with no valid steps', async () => {
        const { port, log } = setup();
        const r = await exec(port, log, 'apply_plan', { summary: 's', steps: [{ tool: 'nope', args: {} }] });
        expect(r.ok).toBe(false);
        expect(r.pending).toBeUndefined();
    });
});
