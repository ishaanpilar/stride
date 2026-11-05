import { beforeEach, describe, expect, it, vi } from 'vitest';

import { focusAiService } from './focus-ai-service';

const { settings, createAIProvider } = vi.hoisted(() => ({
    settings: { ai: { enabled: true, provider: 'openai' } } as { ai?: { enabled?: boolean; provider?: string } },
    createAIProvider: vi.fn(),
}));

vi.mock('@stride/core', async () => {
    const actual = await vi.importActual<typeof import('@stride/core')>('@stride/core');
    return {
        ...actual,
        createAIProvider,
        isSandboxMode: () => false,
        useTaskStore: Object.assign(() => ({}), { getState: () => ({ settings }) }),
    };
});
vi.mock('./ai-config', () => ({
    loadAIKey: vi.fn(async () => 'key'),
    isAIKeyRequired: () => true,
    buildAIConfig: vi.fn(() => ({ provider: 'openai', apiKey: 'key' })),
}));
vi.mock('./app-log', () => ({ logWarn: vi.fn(async () => undefined), logInfo: vi.fn(async () => undefined) }));

const input = { title: 'Write the report', context: {} };

describe('mobile focus AI service', () => {
    beforeEach(() => {
        focusAiService.resetCaches();
        createAIProvider.mockReset();
        settings.ai = { enabled: true, provider: 'openai' };
    });

    it('uses the non-AI coach when AI is off, without creating a provider', async () => {
        settings.ai = { enabled: false };
        const coach = await focusAiService.requestFocusCoach('a', input);
        expect(coach.source).toBe('fallback');
        expect(createAIProvider).not.toHaveBeenCalled();
    });

    it('falls back when the mocked provider fails', async () => {
        createAIProvider.mockReturnValue({ generateText: vi.fn().mockRejectedValue(new Error('network down')) });
        const coach = await focusAiService.requestFocusCoach('b', input);
        expect(coach.source).toBe('fallback');
        expect(coach.motivation.length).toBeGreaterThan(0);
        const reply = await focusAiService.requestFocusCoachReply(input, [{ role: 'user', text: 'waiting on Sam' }]);
        expect(reply.source).toBe('fallback');
        expect(await focusAiService.requestFocusEncouragement('c', { taskTitle: 'x', milestone: 'half', done: 1, total: 2 })).toBeNull();
    });

    it('falls back when the provider cannot be built', async () => {
        createAIProvider.mockImplementation(() => { throw new Error('bad config'); });
        expect((await focusAiService.requestFocusCoach('d', input)).source).toBe('fallback');
    });

    it('drops malformed AI output', async () => {
        createAIProvider.mockReturnValue({ generateText: vi.fn().mockResolvedValue('{"steps": "nope"}') });
        expect((await focusAiService.requestFocusCoach('e', input)).source).toBe('fallback');
    });
});
