import { describe, expect, it } from 'vitest';
import type { Area, Person } from '../../types';
import { runAssistantTurn, runToolCall } from './agent';
import { AssistantChangeLog } from './change-log';
import { buildSystemPrompt } from './prompt';
import { ASSISTANT_TOOLS } from './registry';
import { createFakePort, createScriptedClient, toolCall } from './testing';

const NOW = new Date(2026, 10, 5, 9, 30, 0);
const T = '2026-11-05T09:00:00.000Z';
const exec = (port: any, log: AssistantChangeLog, name: string, args: unknown) =>
    runToolCall({ name, rawArguments: JSON.stringify(args), tools: ASSISTANT_TOOLS, ctx: { port, now: NOW }, changeLog: log, messageId: 'm1' });
const errorOf = (r: { content: string }) => JSON.parse(r.content).error as string;

const frackly = (): Area => ({ id: 'area-frackly-0000', name: 'Frackly Works', order: 0, createdAt: T, updatedAt: T, description: '3D printing company.', keywords: ['Printstick'] });
const mauvi = (): Area => ({ id: 'area-mauvi-00000', name: 'Mauvi Labs', order: 1, createdAt: T, updatedAt: T, peopleIds: ['person-akash'] });
const akash = (): Person => ({ id: 'person-akash', name: 'Akash', createdAt: T, updatedAt: T });

describe('add_area with routing context', () => {
    it('creates an area with a description, keywords and linked people; reports missing people', async () => {
        const { port, areas, people } = createFakePort({ people: [akash()] });
        const log = new AssistantChangeLog();
        const r = await exec(port, log, 'add_area', {
            name: 'Frackly Works',
            description: '3D printing company. The user is the creative director. Printstick is a Frackly Works product.',
            keywords: ['Printstick', '3D printing'],
            people: ['akash', 'Neha'],
        });
        expect(r.ok).toBe(true);
        const area = areas.find((a) => a.name === 'Frackly Works')!;
        expect(area.description).toContain('creative director');
        expect(area.keywords).toEqual(['Printstick', '3D printing']);
        expect(area.peopleIds).toEqual(['person-akash']);
        expect(people).toHaveLength(1); // Neha is not created without consent
        expect(JSON.parse(r.content).missingPeople).toEqual(['Neha']);
        expect(r.entry?.label).toBe("Created area 'Frackly Works' with context");
        expect(r.entry?.details).toEqual(expect.arrayContaining(['Keywords: Printstick, 3D printing', 'People: Akash']));
    });

    it('creates missing people only when allowed, and one undo removes area and people', async () => {
        const { port, areas, people } = createFakePort();
        const log = new AssistantChangeLog();
        const r = await exec(port, log, 'add_area', { name: 'Happy Labs', people: ['Neha'], createMissingPeople: true });
        expect(r.ok).toBe(true);
        expect(people.map((p) => p.name)).toEqual(['Neha']);
        expect(areas[0].peopleIds).toEqual([people[0].id]);
        await log.undo(r.entry!.id, port);
        expect(areas[0].deletedAt).toBeDefined();
        expect(people[0].deletedAt).toBeDefined();
    });

    it('refuses a near-duplicate name and tells the model to ask ONE question', async () => {
        const { port, areas } = createFakePort({ areas: [frackly()] });
        const log = new AssistantChangeLog();
        const r = await exec(port, log, 'add_area', { name: 'Fractal Works', description: 'x' });
        expect(r.ok).toBe(false);
        const error = errorOf(r);
        expect(error).toContain('Similar area already exists: "Frackly Works"');
        expect(error).toContain('ONE question');
        expect(areas).toHaveLength(1);
        // After the user chose "create new":
        const again = await exec(port, log, 'add_area', { name: 'Fractal Works', allowSimilarName: true });
        expect(again.ok).toBe(true);
        expect(areas).toHaveLength(2);
    });

    it('refuses an exact duplicate and points to update_area', async () => {
        const { port } = createFakePort({ areas: [frackly()] });
        const r = await exec(port, new AssistantChangeLog(), 'add_area', { name: 'frackly works' });
        expect(errorOf(r)).toContain('update_area');
    });
});

describe('update_area merges context', () => {
    it('appends by default and never overwrites; undo restores the previous context', async () => {
        const { port, areas } = createFakePort({ areas: [frackly()], people: [akash()] });
        const log = new AssistantChangeLog();
        const r = await exec(port, log, 'update_area', { id: 'Frackly Works', description: 'Akash handles packaging.', keywords: ['Packaging'], people: ['Akash'] });
        expect(r.ok).toBe(true);
        expect(areas[0].description).toBe('3D printing company.\nAkash handles packaging.');
        expect(areas[0].keywords).toEqual(['Printstick', 'Packaging']);
        expect(areas[0].peopleIds).toEqual(['person-akash']);
        expect(r.entry?.label).toBe("Added to the context of 'Frackly Works'");
        await log.undo(r.entry!.id, port);
        expect(areas[0].description).toBe('3D printing company.');
        expect(areas[0].keywords).toEqual(['Printstick']);
        expect(areas[0].peopleIds).toBeUndefined();
    });

    it('replaces only when asked', async () => {
        const { port, areas } = createFakePort({ areas: [frackly()] });
        await exec(port, new AssistantChangeLog(), 'update_area', { id: 'Frackly Works', description: 'Rewritten.', mode: 'replace' });
        expect(areas[0].description).toBe('Rewritten.');
        expect(areas[0].keywords).toEqual(['Printstick']);
    });
});

describe('reading area context', () => {
    it('list_areas and get_area return descriptions, keywords and people names', async () => {
        const { port } = createFakePort({ areas: [frackly(), mauvi()], people: [akash()], projects: [{ title: 'Printstick v2', areaId: 'area-frackly-0000', supportNotes: 'Ship v2 by March' }] });
        const log = new AssistantChangeLog();
        const list = JSON.parse((await exec(port, log, 'list_areas', {})).content);
        expect(list[0]).toMatchObject({ name: 'Frackly Works', description: '3D printing company.', keywords: ['Printstick'] });
        expect(list[1]).toMatchObject({ name: 'Mauvi Labs', people: ['Akash'] });
        const detail = JSON.parse((await exec(port, log, 'get_area', { id: 'frackly works' })).content);
        expect(detail).toMatchObject({ name: 'Frackly Works', projects: [{ title: 'Printstick v2', purpose: 'Ship v2 by March' }] });
    });

    it('find_area_candidates finds tasks and projects that mention the area, its keywords or people', async () => {
        const { port } = createFakePort({
            areas: [frackly(), mauvi()], people: [akash()],
            tasks: [{ title: 'Packaging requirement for Frackly Works' }, { title: 'Printstick nozzle order' }, { title: 'Buy milk' }],
            projects: [{ title: 'Printstick launch' }],
        });
        const data = JSON.parse((await exec(port, new AssistantChangeLog(), 'find_area_candidates', { id: 'Frackly Works' })).content);
        expect(data.tasks.map((t: { title: string }) => t.title)).toEqual(['Packaging requirement for Frackly Works', 'Printstick nozzle order']);
        expect(data.tasks[0].reason).toBe('mentions Frackly Works → Frackly Works');
        expect(data.projects.map((p: { title: string }) => p.title)).toEqual(['Printstick launch']);
    });
});

describe('routing tasks with a reason', () => {
    it('add_task puts a task in an area and records a validated reason', async () => {
        const { port, tasks } = createFakePort({ areas: [mauvi()] });
        const r = await exec(port, new AssistantChangeLog(), 'add_task', { title: 'Send quotation to Akash', areaId: 'Mauvi Labs', reason: 'mentions Akash -> Mauvi Labs' });
        expect(r.ok).toBe(true);
        expect(tasks[0].areaId).toBe('area-mauvi-00000');
        expect(r.entry?.reason).toBe('mentions Akash → Mauvi Labs');
        expect(r.entry?.label).toContain('Mauvi Labs');
    });

    it('rejects an unknown area instead of inventing one', async () => {
        const { port, tasks } = createFakePort({ areas: [mauvi()] });
        const r = await exec(port, new AssistantChangeLog(), 'add_task', { title: 'x', areaId: 'Atlantis' });
        expect(r.ok).toBe(false);
        expect(errorOf(r)).toContain('Unknown area "Atlantis"');
        expect(tasks).toHaveLength(0);
    });

    it('update_task moves a task out of its project into an area; move_tasks moves several', async () => {
        const { port, tasks } = createFakePort({ areas: [frackly()], projects: [{ title: 'Misc' }], tasks: [{ title: 'Nozzles', projectId: 'proj1-0000-0000-0000-000000000000' }, { title: 'Resin' }] });
        const log = new AssistantChangeLog();
        const r = await exec(port, log, 'update_task', { id: 'task1', areaId: 'Frackly Works', reason: 'mentions Printstick' });
        expect(r.ok).toBe(true);
        expect(tasks[0].areaId).toBe('area-frackly-0000');
        expect(tasks[0].projectId).toBeUndefined();
        expect(r.entry?.reason).toBe('mentions Printstick');
        await log.undo(r.entry!.id, port);
        expect(tasks[0].projectId).toBe('proj1-0000-0000-0000-000000000000');
        const moved = await exec(port, log, 'move_tasks', { ids: ['task1', 'task2'], areaId: 'Frackly Works', reason: 'printing work' });
        expect(moved.ok).toBe(true);
        expect(tasks.every((t) => t.areaId === 'area-frackly-0000')).toBe(true);
        expect(moved.entry?.reason).toBe('printing work');
    });
});

describe('assistant prompt', () => {
    it('explains areas vs projects and includes the bounded routing context as data', () => {
        const { port } = createFakePort({ areas: [frackly(), mauvi()], people: [akash()] });
        const prompt = buildSystemPrompt({ ...port, getRoutingCorrections: () => [{ at: T, text: 'Quote for Akash', fromArea: 'Prad', toArea: 'Mauvi Labs' }] }, NOW);
        expect(prompt).toContain('Areas vs projects (GTD)');
        expect(prompt).toContain('ROUTING_CONTEXT');
        expect(prompt).toContain('- Frackly Works: 3D printing company. Keywords: Printstick.');
        expect(prompt).toContain('People: Akash.');
        expect(prompt).toContain("'Quote for Akash' belongs in Mauvi Labs (not Prad)");
        expect(prompt).toContain('ask ONE short question');
        expect(prompt).not.toMatch(/api[_-]?key/i);
    });

    it('full turn with a mocked model: "build me an area" creates it and the Changes entry carries the context', async () => {
        const { port, areas } = createFakePort({ areas: [mauvi()] });
        const { client, requests } = createScriptedClient([
            { toolCalls: [toolCall('add_area', { name: 'Frackly Works', description: '3D printing company. The user is the creative director.', keywords: ['Printstick'] })] },
            { content: "Created 'Frackly Works'.\n```suggestions\n[\"Move matching tasks\"]\n```" },
        ]);
        const result = await runAssistantTurn({
            client, port, changeLog: new AssistantChangeLog(), messageId: 'm1', now: NOW,
            userText: 'Build me an area for Frackly Works. It is a 3D printing company, I am the creative director. Printstick is from Frackly Works.',
        });
        expect(result.status).toBe('ok');
        expect(areas.find((a) => a.name === 'Frackly Works')?.keywords).toEqual(['Printstick']);
        expect(result.entries[0].details?.[0]).toContain('3D printing company');
        expect(requests[0].tools.map((t) => t.name)).toEqual(expect.arrayContaining(['get_area', 'find_area_candidates']));
    });
});
