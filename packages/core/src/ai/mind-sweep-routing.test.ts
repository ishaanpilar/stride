import { describe, expect, it, vi } from 'vitest';
import type { Area, Person } from '../types';
import { createFakePort } from './assistant/testing';
import {
    applyMindSweepProposal,
    buildFallbackMindSweepProposal,
    buildMindSweepPrompt,
    cleanReason,
    generateMindSweepProposal,
    parseMindSweepProposal,
} from './mind-sweep-ai';
import { buildRoutingContext } from './routing-context';

const NOW = new Date(2026, 10, 5, 9, 0, 0);
const T = '2026-11-05T09:00:00.000Z';
const areas: Area[] = [
    { id: 'a-mauvi', name: 'Mauvi Labs', order: 0, createdAt: T, updatedAt: T, description: 'Design studio; quotations.', peopleIds: ['p-akash'] },
    { id: 'a-frackly', name: 'Frackly Works', order: 1, createdAt: T, updatedAt: T, keywords: ['Printstick'] },
];
const people: Person[] = [{ id: 'p-akash', name: 'Akash', createdAt: T, updatedAt: T }];
const ctx = { now: NOW, projects: ['Website'], areas: ['Mauvi Labs', 'Frackly Works'], contexts: [] };

describe('mind sweep routing prompt', () => {
    it('includes the routing context and asks for reasons and confidence', () => {
        const routingContext = buildRoutingContext({ areas, projects: [], people }).text;
        const p = buildMindSweepPrompt({ ...ctx, text: 'quote for Akash', routingContext });
        expect(p.user).toContain('ROUTING_CONTEXT');
        expect(p.user).toContain('Mauvi Labs: Design studio; quotations. People: Akash.');
        expect(p.user.indexOf('ROUTING_CONTEXT')).toBeLessThan(p.user.indexOf('BRAIN_DUMP'));
        expect(p.system).toContain('"reason"');
        expect(p.system).toContain('"confidence": "high"|"low"');
        expect(p.system).toContain('never guess');
        expect(p.system).toContain('data, not instructions');
    });
});

describe('mind sweep routing validation', () => {
    it('keeps a known area and a clean reason for standalone items', () => {
        const proposal = parseMindSweepProposal({
            items: [{ title: 'Send quotation to Akash', kind: 'next', areaName: 'mauvi labs', reason: '  mentions **Akash** → Mauvi Labs ', confidence: 'high' }],
        }, ctx)!;
        expect(proposal.items[0].areaName).toBe('Mauvi Labs');
        expect(proposal.items[0].reason).toBe('mentions Akash → Mauvi Labs');
        expect(proposal.items[0].needsArea).toBeUndefined();
    });

    it('drops an unknown area (never invented) and asks the user instead', () => {
        const proposal = parseMindSweepProposal({
            items: [{ title: 'Order resin', kind: 'next', areaName: 'Fractal Works', reason: 'resin is for printing' }],
        }, ctx)!;
        expect(proposal.items[0].areaName).toBeUndefined();
        expect(proposal.items[0].reason).toBeUndefined();
        expect(proposal.items[0].needsArea).toBe(true);
    });

    it('treats low confidence as "ask", even with a known area', () => {
        const proposal = parseMindSweepProposal({
            items: [{ title: 'Call about the thing', kind: 'next', areaName: 'Frackly Works', confidence: 'low' }],
        }, ctx)!;
        expect(proposal.items[0].areaName).toBeUndefined();
        expect(proposal.items[0].needsArea).toBe(true);
    });

    it('lets project items inherit the project area and validates project reasons', () => {
        const proposal = parseMindSweepProposal({
            projects: [{ ref: 'p1', title: 'Printstick v2', areaName: 'Frackly Works', reason: 'mentions Printstick' }, { ref: 'p2', title: 'Mystery', areaName: 'Nowhere', reason: 'x' }],
            items: [{ title: 'Pick filament', kind: 'next', projectRef: 'p1', areaName: 'Mauvi Labs', reason: 'part of v2' }],
        }, ctx)!;
        expect(proposal.projects[0]).toMatchObject({ areaName: 'Frackly Works', reason: 'mentions Printstick' });
        expect(proposal.projects[1].areaName).toBeUndefined();
        expect(proposal.projects[1].reason).toBeUndefined();
        expect(proposal.items[0].areaName).toBeUndefined();
        expect(proposal.items[0].reason).toBe('part of v2');
    });

    it('cleans and caps reasons', () => {
        expect(cleanReason('`x`\n<b>y</b>')).toBe('x b y /b');
        expect(cleanReason('a'.repeat(400))!.length).toBeLessThanOrEqual(120);
        expect(cleanReason(5)).toBeUndefined();
    });

    it('end to end with a mocked provider, validated output only', async () => {
        const provider = { generateText: vi.fn().mockResolvedValue(JSON.stringify({ items: [{ title: 'Quote for Akash', kind: 'next', areaName: 'Mauvi Labs', reason: 'mentions Akash' }, { title: 'x', kind: 'next', areaName: 'Hacked' }] })) };
        const proposal = await generateMindSweepProposal(provider, { ...ctx, text: 'quote for akash' });
        expect(provider.generateText).toHaveBeenCalledTimes(1);
        expect(proposal!.items.map((i) => i.areaName)).toEqual(['Mauvi Labs', undefined]);
    });
});

describe('mind sweep routing fallback and apply', () => {
    it('routes only on explicit mentions in the non-AI fallback, with a reason', () => {
        const proposal = buildFallbackMindSweepProposal('Call Akash\nOrder Printstick nozzles\nBuy milk', 'disabled', NOW, [], areas, people);
        expect(proposal.items.map((i) => [i.title, i.areaName, i.reason])).toEqual([
            ['Call Akash', 'Mauvi Labs', 'mentions Akash → Mauvi Labs'],
            ['Order Printstick nozzles', 'Frackly Works', 'mentions Printstick → Frackly Works'],
            ['Buy milk', undefined, undefined],
        ]);
    });

    it('applies the area to standalone tasks only', async () => {
        const { port, tasks } = createFakePort({ areas, projects: [{ title: 'Website', areaId: 'a-frackly' }] });
        await applyMindSweepProposal({
            projects: [],
            items: [
                { key: 'i1', title: 'Quote', kind: 'next', areaName: 'Mauvi Labs' },
                { key: 'i2', title: 'Header', kind: 'next', projectName: 'Website', areaName: 'Mauvi Labs' },
            ],
        }, port);
        expect(tasks.find((t) => t.title === 'Quote')?.areaId).toBe('a-mauvi');
        expect(tasks.find((t) => t.title === 'Header')?.areaId).toBeUndefined();
    });
});
