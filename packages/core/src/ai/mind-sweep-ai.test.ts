import { describe, expect, it, vi } from 'vitest';

import type { Project } from '../types';
import {
    applyMindSweepProposal,
    buildFallbackMindSweepProposal,
    buildMindSweepPrompt,
    generateMindSweepProposal,
    parseMindSweepProposal,
    undoMindSweep,
} from './mind-sweep-ai';

const NOW = new Date(2026, 10, 4, 9, 0, 0); // Wed 2026-11-04
const ctx = { now: NOW, projects: ['Website'], areas: ['Work'], contexts: ['@desk'] };

describe('buildMindSweepPrompt', () => {
    it('sends only the dump plus names, and stays lean', () => {
        const p = buildMindSweepPrompt({ ...ctx, text: 'call dentist\nraj owes me the invoice', timeZone: 'Asia/Kolkata' });
        expect(p.user).toContain('EXISTING_PROJECTS: ["Website"]');
        expect(p.user).toContain('call dentist');
        expect(p.system).toContain('2026-11-04T09:00');
        expect(p.system).toContain('Asia/Kolkata');
        expect(p.system.length + p.user.length).toBeLessThan(3500);
    });
    it('truncates huge input', () => {
        const p = buildMindSweepPrompt({ ...ctx, text: 'x'.repeat(50_000) });
        expect(p.user.length).toBeLessThan(13_000);
    });
});

describe('parseMindSweepProposal', () => {
    const good = {
        projects: [{ ref: 'p1', title: 'Plan trip', areaName: 'work', dueDate: '2026-12-01' }, { ref: 'p2', title: 'website' }],
        items: [
            { title: 'Book flights', kind: 'next', projectRef: 'p1', dueDate: '2026-11-10', contexts: ['desk'], priority: 'high', timeEstimate: '30min' },
            { title: 'Fix header', kind: 'next', projectName: 'Website' },
            { title: 'Chase invoice', kind: 'waiting', waitingFor: 'Raj' },
        ],
        summary: 'Organised.',
    };
    it('accepts valid output (also inside code fences) and normalises', () => {
        const p = parseMindSweepProposal('```json\n' + JSON.stringify(good) + '\n```', ctx)!;
        expect(p.source).toBe('ai');
        // "website" duplicates an existing project, so it is not a new project
        expect(p.projects.map((x) => x.ref)).toEqual(['p1']);
        expect(p.projects[0].areaName).toBe('Work');
        expect(p.items[0]).toMatchObject({ projectRef: 'p1', contexts: ['@desk'], timeEstimate: '30min', dueDate: '2026-11-10' });
        expect(p.items[1].projectName).toBe('Website');
        expect(p.items[2]).toMatchObject({ kind: 'waiting', waitingFor: 'Raj' });
    });
    it('returns null for malformed / empty output', () => {
        expect(parseMindSweepProposal('not json', ctx)).toBeNull();
        expect(parseMindSweepProposal('[]', ctx)).toBeNull();
        expect(parseMindSweepProposal({ items: [], projects: [] }, ctx)).toBeNull();
        expect(parseMindSweepProposal(null, ctx)).toBeNull();
    });
    it('drops unknown project names/refs, bad and past dates, empty and duplicate titles', () => {
        const p = parseMindSweepProposal({
            items: [
                { title: 'A', kind: 'next', projectName: 'Nope', projectRef: 'zzz' },
                { title: 'a', kind: 'next' },
                { title: '   ', kind: 'next' },
                { title: 'B', kind: 'bogus', dueDate: '2026-02-30', startTime: '2020-01-01' },
                { title: 'C', kind: 'calendar', dueDate: 'tomorrow' },
                { kind: 'next' },
            ],
        }, ctx)!;
        expect(p.items.map((i) => i.title)).toEqual(['A', 'B', 'C']);
        expect(p.items[0].projectName).toBeUndefined();
        expect(p.items[0].projectRef).toBeUndefined();
        expect(p.items[1]).not.toHaveProperty('dueDate');
        expect(p.items[1]).not.toHaveProperty('startTime');
        expect(p.items[1].kind).toBe('next');
        expect(p.items[2]).not.toHaveProperty('dueDate');
    });
    it('caps items and title length', () => {
        const items = Array.from({ length: 90 }, (_, i) => ({ title: `Task ${i}`, kind: 'next' }));
        expect(parseMindSweepProposal({ items }, ctx)!.items).toHaveLength(60);
        const long = parseMindSweepProposal({ items: [{ title: 'x'.repeat(500) }] }, ctx)!;
        expect(long.items[0].title.length).toBeLessThanOrEqual(200);
    });
});

describe('generateMindSweepProposal', () => {
    const input = { ...ctx, text: 'buy milk' };
    it('returns a parsed proposal from the provider', async () => {
        const generateText = vi.fn().mockResolvedValue(JSON.stringify({ items: [{ title: 'Buy milk', kind: 'next' }], summary: 's' }));
        const p = await generateMindSweepProposal({ generateText }, input);
        expect(p?.items[0].title).toBe('Buy milk');
        expect(generateText).toHaveBeenCalledOnce();
    });
    it('returns null on provider error, garbage, empty input, missing generateText', async () => {
        expect(await generateMindSweepProposal({ generateText: vi.fn().mockRejectedValue(new Error('x')) }, input)).toBeNull();
        expect(await generateMindSweepProposal({ generateText: vi.fn().mockResolvedValue('lol') }, input)).toBeNull();
        expect(await generateMindSweepProposal({ generateText: vi.fn() }, { ...input, text: '  ' })).toBeNull();
        expect(await generateMindSweepProposal({}, input)).toBeNull();
    });
    it('returns null on timeout', async () => {
        const generateText = vi.fn(() => new Promise<string>(() => undefined));
        expect(await generateMindSweepProposal({ generateText }, input, { timeoutMs: 20 })).toBeNull();
    });
});

describe('fallback', () => {
    it('turns lines and bullets into inbox items with quick-add parsing', () => {
        const p = buildFallbackMindSweepProposal('- Call mom @phone\n* Buy milk\n3) Buy milk\n\n', 'disabled', NOW);
        expect(p.source).toBe('fallback');
        expect(p.fallbackReason).toBe('disabled');
        expect(p.items.map((i) => i.title)).toEqual(['Call mom', 'Buy milk']);
        expect(p.items.every((i) => i.kind === 'inbox')).toBe(true);
        expect(p.items[0].contexts).toContain('@phone');
    });
});

describe('apply + undo', () => {
    it('creates projects first, then items, and undoes everything', async () => {
        const calls: string[] = [];
        const projects: Project[] = [{ id: 'ex1', title: 'Website', status: 'active' } as Project];
        const port = {
            getSnapshot: () => ({ tasks: [], projects, areas: [{ id: 'a1', name: 'Work', order: 0 }] as never }),
            addProject: vi.fn(async (title: string) => { calls.push(`P:${title}`); return { id: 'np1', title } as Project; }),
            addTask: vi.fn(async (title: string) => { calls.push(`T:${title}`); return { success: true, id: `t-${title}` }; }),
            deleteTask: vi.fn(async () => ({ success: true })),
            deleteProject: vi.fn(async () => ({ success: true })),
        };
        const proposal = parseMindSweepProposal({
            projects: [{ ref: 'p1', title: 'Trip', areaName: 'Work' }, { ref: 'p9', title: 'Unused' }],
            items: [
                { title: 'Book', kind: 'next', projectRef: 'p1' },
                { title: 'Fix', kind: 'next', projectName: 'Website' },
                { title: 'Wait', kind: 'waiting', waitingFor: 'Raj' },
            ],
        }, ctx)!;
        const applied = await applyMindSweepProposal(proposal, port);
        expect(calls).toEqual(['P:Trip', 'T:Book', 'T:Fix', 'T:Wait']);
        expect(port.addTask).toHaveBeenNthCalledWith(1, 'Book', expect.objectContaining({ projectId: 'np1', status: 'next' }));
        expect(port.addTask).toHaveBeenNthCalledWith(2, 'Fix', expect.objectContaining({ projectId: 'ex1' }));
        expect(port.addTask).toHaveBeenNthCalledWith(3, 'Wait', expect.objectContaining({ status: 'waiting', assignedTo: 'Raj' }));
        expect(port.addProject).toHaveBeenCalledWith('Trip', expect.any(String), expect.objectContaining({ areaId: 'a1' }));
        expect(applied.taskIds).toHaveLength(3);
        expect(await undoMindSweep(applied, port)).toBe(true);
        expect(port.deleteTask).toHaveBeenCalledTimes(3);
        expect(port.deleteProject).toHaveBeenCalledTimes(1);
    });
});
