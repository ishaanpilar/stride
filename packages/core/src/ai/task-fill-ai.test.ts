import { describe, expect, it, vi } from 'vitest';
import type { Area, Project, Task } from '../types';
import {
    buildFallbackTaskFill,
    buildTaskFillInput,
    buildTaskFillPrompt,
    detectImpliedDate,
    fillTaskWithAI,
    getTaskFillEmptyFields,
    parseTaskFillResponse,
    type TaskFillCurrent,
    type TaskFillInput,
} from './task-fill-ai';

const NOW = new Date(2026, 10, 5, 10, 0, 0); // Thu 5 Nov 2026, local

const area = (id: string, name: string, extra: Partial<Area> = {}): Area => ({
    id, name, order: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
}) as Area;
const project = (id: string, title: string, extra: Partial<Project> = {}): Project => ({
    id, title, status: 'active', color: '#000', order: 0, tagIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
}) as Project;
const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({
    id, title, status: 'next', tags: [], contexts: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});

const AREAS = [area('a-health', 'Health', { keywords: ['dentist'] }), area('a-frackly', 'Frackly Works')];
const PROJECTS = [project('p-teeth', 'Teeth repair', { areaId: 'a-health' })];

const makeInput = (current: Partial<TaskFillCurrent> = {}, extra: { tasks?: Task[]; base?: Task } = {}): TaskFillInput => {
    const base = extra.base ?? task('t1', current.title ?? 'Go to the dentist and get teeth filled');
    return buildTaskFillInput({
        task: base,
        current: { title: base.title, ...current },
        tasks: [base, ...(extra.tasks ?? [])],
        projects: PROJECTS,
        areas: AREAS,
        knownContexts: ['@health', '@errands', '@computer'],
        knownTags: ['#admin'],
        prioritiesEnabled: true,
        timeEstimatesEnabled: true,
        now: NOW,
    });
};

describe('task fill: inputs', () => {
    it('marks only empty fields as fillable', () => {
        const empty = getTaskFillEmptyFields(
            { title: 'x', projectId: 'p1', contexts: ['@home'], tags: [], priority: 'high', timeEstimate: '', dueDate: '', checklistCount: 2 },
            { prioritiesEnabled: true, timeEstimatesEnabled: false },
        );
        expect(empty).toEqual({
            destination: false, contexts: false, tags: true, priority: false,
            timeEstimate: false, dueDate: true, startTime: true, checklist: false,
        });
    });

    it('detects a date the title names, and nothing otherwise', () => {
        expect(detectImpliedDate('Go to the dentist tomorrow', NOW)).toBe('2026-11-06');
        expect(detectImpliedDate('Go to the dentist and get teeth filled', NOW)).toBeUndefined();
    });

    it('finds the deterministic area match and puts the routing data in the prompt', () => {
        const input = makeInput();
        expect(input.areaMatch).toMatchObject({ id: 'a-health', name: 'Health' });
        const prompt = buildTaskFillPrompt(input);
        expect(prompt.user).toContain('Go to the dentist');
        expect(prompt.user).toContain('Teeth repair');
        expect(prompt.user).toContain('KNOWN_CONTEXTS');
        expect(prompt.system).toContain('steps: omit');
    });
});

describe('task fill: parse and validate', () => {
    it('accepts a valid response and resolves names to ids', () => {
        const input = makeInput({ title: 'Go to the dentist tomorrow' });
        const proposals = parseTaskFillResponse(JSON.stringify({
            project: 'teeth repair', destinationReason: 'Dentist work lives in Teeth repair',
            contexts: ['health', '@errands'], contextsReason: 'Out of the house',
            tags: ['#Admin'],
            priority: 'high', priorityReason: 'Health first',
            timeEstimateMinutes: 60,
            dueDate: '2026-11-06', dateReason: 'Says tomorrow',
        }), input);
        expect(proposals).toEqual([
            { field: 'destination', kind: 'project', id: 'p-teeth', label: 'Teeth repair', reason: 'Dentist work lives in Teeth repair' },
            { field: 'contexts', values: ['@health', '@errands'], newValues: [], reason: 'Out of the house' },
            { field: 'tags', values: ['#admin'], newValues: [] },
            { field: 'priority', value: 'high', reason: 'Health first' },
            { field: 'timeEstimate', value: '1hr' },
            { field: 'dueDate', value: '2026-11-06', reason: 'Says tomorrow' },
        ]);
    });

    it('returns null for output that is not a JSON object', () => {
        expect(parseTaskFillResponse('sure! here you go', makeInput())).toBeNull();
        expect(parseTaskFillResponse('[1,2]', makeInput())).toBeNull();
    });

    it('drops unknown projects/areas, bad enums, invalid dates and extra new tokens', () => {
        const proposals = parseTaskFillResponse(JSON.stringify({
            project: 'Invented project', area: 'Nowhere',
            contexts: ['brand new', '@dentist-visit', '@another'],
            priority: 'critical',
            timeEstimateMinutes: -5,
            dueDate: '2026-11-06',
        }), makeInput());
        // Only one clearly-new well-formed token; no destination; no date (title names none).
        expect(proposals).toEqual([{ field: 'contexts', values: ['@dentist-visit'], newValues: ['@dentist-visit'] }]);
    });

    it('falls back to the area when the project is unknown', () => {
        const proposals = parseTaskFillResponse({ project: 'Nope', area: 'health' }, makeInput());
        expect(proposals).toEqual([{ field: 'destination', kind: 'area', id: 'a-health', label: 'Health' }]);
    });

    it('never proposes steps without notes or related tasks', () => {
        const proposals = parseTaskFillResponse({
            steps: [{ title: 'Call the clinic to book', source: 'common sense' }],
        }, makeInput());
        expect(proposals).toEqual([]);
    });

    it('keeps grounded steps with a source and drops generic ones', () => {
        const input = makeInput({ description: 'Ask about the crown. Bring the insurance card.' });
        const proposals = parseTaskFillResponse({
            steps: [
                { title: 'Ask about the crown', source: 'notes' },
                { title: 'Bring the insurance card', source: 'notes' },
                { title: 'Take a deep breath', source: 'notes' },
                { title: 'No source step' },
            ],
        }, input);
        expect(proposals).toEqual([{ field: 'checklist', values: ['Ask about the crown', 'Bring the insurance card'], reason: 'From the notes and related tasks' }]);
    });

    it('only fills empty fields', () => {
        const input = makeInput({
            title: 'Go to the dentist tomorrow', areaId: 'a-health', contexts: ['@health'], tags: ['#admin'],
            priority: 'low', timeEstimate: '30min', dueDate: '2026-11-20',
        });
        const proposals = parseTaskFillResponse({
            area: 'Frackly Works', contexts: ['@errands'], tags: ['#admin'], priority: 'urgent',
            timeEstimateMinutes: 90, dueDate: '2026-11-06', startDate: '2026-11-06',
        }, input);
        expect(proposals).toEqual([{ field: 'startTime', value: '2026-11-06' }]);
    });

    it('rejects past dates', () => {
        const proposals = parseTaskFillResponse({ dueDate: '2020-01-01' }, makeInput({ title: 'Dentist tomorrow' }));
        expect(proposals).toEqual([]);
    });
});

describe('task fill: provider call', () => {
    it('uses a mocked provider and merges deterministic suggestions for fields it skipped', async () => {
        const generateText = vi.fn(async () => '```json\n{"priority":"medium","priorityReason":"Routine visit"}\n```');
        const result = await fillTaskWithAI({ generateText }, makeInput({ title: 'Go to the dentist tomorrow' }));
        expect(generateText).toHaveBeenCalledTimes(1);
        expect(result.source).toBe('ai');
        expect(result.proposals.map((p) => p.field)).toEqual(['priority', 'destination', 'dueDate']);
    });

    it('falls back on invalid output, errors and timeouts', async () => {
        const input = makeInput({ title: 'Go to the dentist tomorrow' });
        const expected = buildFallbackTaskFill(input);
        expect(expected.proposals.map((p) => p.field)).toEqual(['destination', 'dueDate']);
        await expect(fillTaskWithAI({ generateText: async () => 'nope' }, input)).resolves.toEqual(expected);
        await expect(fillTaskWithAI({ generateText: async () => { throw new Error('boom'); } }, input)).resolves.toEqual(expected);
        await expect(fillTaskWithAI({ generateText: () => new Promise<string>(() => undefined) }, input, { timeoutMs: 5 })).resolves.toEqual(expected);
        await expect(fillTaskWithAI(null, input)).resolves.toEqual(expected);
    });

    it('does not call the provider when nothing is empty', async () => {
        const generateText = vi.fn(async () => '{}');
        const input = makeInput({
            areaId: 'a-health', contexts: ['@health'], tags: ['#admin'], priority: 'low', timeEstimate: '30min',
            dueDate: '2026-11-20', startTime: '2026-11-19', checklistCount: 1,
        });
        await fillTaskWithAI({ generateText }, input);
        expect(generateText).not.toHaveBeenCalled();
    });
});
