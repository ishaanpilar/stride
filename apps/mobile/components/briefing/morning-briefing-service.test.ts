import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureBriefing, resetBriefingServiceForTests } from './morning-briefing-service';

const store = vi.hoisted(() => new Map<string, string>());
const core = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: async (k: string) => store.get(k) ?? null,
        setItem: async (k: string, v: string) => { store.set(k, v); },
        removeItem: async (k: string) => { store.delete(k); },
    },
}));
vi.mock('@/lib/ai-config', () => ({
    loadAIKey: async () => 'test-key',
    buildAIConfig: () => ({ provider: 'openai', apiKey: 'test-key', model: 'm' }),
}));
vi.mock('@stride/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@stride/core')>()),
    createAIProvider: () => ({}),
    generateDailyBriefing: (...a: unknown[]) => core.generate(...a),
    useTaskStore: { getState: () => ({ settings: { ai: { enabled: true } }, tasks: [], projects: [] }) },
}));

const briefing = { headline: 'H', top: [{ taskId: 'a', why: 'w' }], schedule: [], suggestion: 's' };

describe('ensureBriefing', () => {
    beforeEach(() => { store.clear(); core.generate.mockReset(); resetBriefingServiceForTests(); });

    it('generates once per day and serves the cache afterwards', async () => {
        core.generate.mockResolvedValue(briefing);
        expect(await ensureBriefing()).toEqual(briefing);
        expect(await ensureBriefing()).toEqual(briefing);
        expect(core.generate).toHaveBeenCalledTimes(1);
        await ensureBriefing({ force: true });
        expect(core.generate).toHaveBeenCalledTimes(2);
    });

    it('resolves null when the provider fails', async () => {
        core.generate.mockRejectedValue(new Error('boom'));
        expect(await ensureBriefing()).toBeNull();
    });
});
