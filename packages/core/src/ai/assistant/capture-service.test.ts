import { describe, expect, it } from 'vitest';

import { applyAiCapture, generateAiCaptureProposal, undoAiCapture, type AiCaptureDeps } from './capture-service';
import { createFakePort } from './testing';

const state = (ai: Record<string, unknown>) => ({ settings: { ai }, projects: [], areas: [], tasks: [], people: [] }) as never;
const deps = (reply: string | Error, ai: Record<string, unknown> = { enabled: true, provider: 'openai', model: 'm' }): AiCaptureDeps => ({
    getState: () => state(ai),
    loadKey: async () => 'key',
    buildConfig: () => ({ provider: 'openai', apiKey: 'key', model: 'm' }) as never,
    createProvider: (() => ({ generateText: async () => { if (reply instanceof Error) throw reply; return reply; } })) as never,
});

describe('AI capture service', () => {
    it('parses a valid proposal from the mocked provider', async () => {
        const json = JSON.stringify({ projects: [], items: [{ title: 'Email Sam', kind: 'next' }], summary: 's' });
        const p = await generateAiCaptureProposal(deps(json), 'email sam');
        expect(p.source).toBe('ai');
        expect(p.items[0].title).toBe('Email Sam');
    });

    it('falls back per line on invalid JSON', async () => {
        const p = await generateAiCaptureProposal(deps('not json at all'), 'one\ntwo');
        expect(p.source).toBe('fallback');
        expect(p.fallbackReason).toBe('failed');
        expect(p.items.map((i) => i.title)).toEqual(['one', 'two']);
    });

    it('falls back when the provider throws or AI is off', async () => {
        expect((await generateAiCaptureProposal(deps(new Error('x')), 'a')).fallbackReason).toBe('failed');
        expect((await generateAiCaptureProposal(deps('{}', { enabled: false }), 'a')).fallbackReason).toBe('disabled');
    });

    it('applies then undoes a batch', async () => {
        const { port, tasks } = createFakePort();
        const result = await applyAiCapture(port, { projects: [], items: [{ key: 'k', title: 'Do it', kind: 'inbox' }] });
        expect(tasks.some((t) => t.title === 'Do it' && !t.deletedAt)).toBe(true);
        expect(await undoAiCapture(port, result)).toBe(true);
        expect(tasks.find((t) => t.title === 'Do it')!.deletedAt).toBeDefined();
    });
});
