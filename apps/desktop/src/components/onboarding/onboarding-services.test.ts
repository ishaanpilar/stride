import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateText = vi.fn();
const saveAIKey = vi.fn(async () => undefined);
const updateSettingsFromLatest = vi.fn(async (build: (s: Record<string, unknown>) => unknown) => { build({ ai: { enabled: false } }); return true; });

vi.mock('@stride/core', async (original) => ({
    ...(await original<typeof import('@stride/core')>()),
    createAIProvider: vi.fn(() => ({ generateText })),
    updateSettingsFromLatest: (...args: unknown[]) => updateSettingsFromLatest(...(args as [never])),
}));
vi.mock('../../lib/ai-config', () => ({
    buildAIConfig: vi.fn(async (settings: { ai: { provider: string } }, apiKey: string) => ({ provider: settings.ai.provider, apiKey, model: 'm' })),
    saveAIKey: (...args: unknown[]) => saveAIKey(...(args as [])),
}));
vi.mock('../../lib/launch-at-startup', () => ({ getLaunchAtStartupEnabled: vi.fn(), setLaunchAtStartupEnabled: vi.fn() }));
vi.mock('../../lib/desktop-calendar-push-sync', () => ({
    enableDesktopCalendarPush: vi.fn(async () => true),
    setDesktopCalendarPushEnabled: vi.fn(async () => undefined),
    stopDesktopCalendarPushSync: vi.fn(),
}));
vi.mock('../../lib/system-calendar', () => ({ requestSystemCalendarPermission: vi.fn(async () => 'granted') }));

import { createAIProvider } from '@stride/core';
import { buildAiSettingsPatch, classifyAiError, saveAiChoice, testAiKey, enableCalendarSync } from './onboarding-services';
import { requestSystemCalendarPermission } from '../../lib/system-calendar';

describe('onboarding services', () => {
    beforeEach(() => vi.clearAllMocks());

    it('maps DeepSeek to the openai provider with a base URL, and Claude to anthropic', () => {
        expect(buildAiSettingsPatch('deepseek')).toMatchObject({ provider: 'openai', baseUrl: 'https://api.deepseek.com', enabled: true });
        expect(buildAiSettingsPatch('claude')).toMatchObject({ provider: 'anthropic', enabled: true });
    });

    it('classifies provider errors', () => {
        expect(classifyAiError(new Error('OpenAI API key is invalid or missing.'))).toBe('badKey');
        expect(classifyAiError(new Error('rate limit or quota exceeded'))).toBe('rateLimit');
        expect(classifyAiError(new TypeError('Failed to fetch'))).toBe('network');
    });

    it('tests a key with one provider request through the shared abstraction', async () => {
        generateText.mockResolvedValueOnce('ok');
        await expect(testAiKey('claude', ' k ')).resolves.toEqual({ ok: true });
        expect(createAIProvider).toHaveBeenCalledTimes(1);
        expect(generateText).toHaveBeenCalledTimes(1);
        expect(vi.mocked(createAIProvider).mock.calls[0][0]).toMatchObject({ apiKey: 'k', provider: 'anthropic' });
    });

    it('reports a rejected key and a network failure', async () => {
        generateText.mockRejectedValueOnce(new Error('OpenAI-compatible endpoint rejected the request.'));
        await expect(testAiKey('deepseek', 'k')).resolves.toEqual({ ok: false, reason: 'badKey' });
        generateText.mockRejectedValueOnce(new Error('network down'));
        await expect(testAiKey('deepseek', 'k')).resolves.toEqual({ ok: false, reason: 'network' });
    });

    it('saves the key via the Settings > AI storage path and enables AI', async () => {
        await saveAiChoice('deepseek', ' key ');
        expect(saveAIKey).toHaveBeenCalledWith('openai', 'key');
        expect(updateSettingsFromLatest).toHaveBeenCalledTimes(1);
    });

    it('does not enable calendar sync when permission is denied', async () => {
        vi.mocked(requestSystemCalendarPermission).mockResolvedValueOnce('denied');
        await expect(enableCalendarSync()).resolves.toBe('denied');
        await expect(enableCalendarSync()).resolves.toBe('enabled');
    });
});
