import {
    DEEPSEEK_BASE_URL,
    DEEPSEEK_DEFAULT_MODEL,
    createAIProvider,
    getDefaultAIConfig,
    getDefaultCopilotModel,
    updateSettingsFromLatest,
    useTaskStore,
    type Language,
} from '@stride/core';
import { buildAIConfig, saveAIKey } from '../../lib/ai-config';
import { getLaunchAtStartupEnabled, setLaunchAtStartupEnabled } from '../../lib/launch-at-startup';
import {
    enableDesktopCalendarPush,
    setDesktopCalendarPushEnabled,
    stopDesktopCalendarPushSync,
} from '../../lib/desktop-calendar-push-sync';
import { requestSystemCalendarPermission } from '../../lib/system-calendar';
import {
    applyQuickCapture,
    generateQuickCaptureProposal,
    isQuickCaptureAIReady,
} from '../../lib/quick-capture-service';

export type OnboardingProviderChoice = 'deepseek' | 'claude';
export type KeyTestResult = { ok: true } | { ok: false; reason: 'badKey' | 'network' | 'rateLimit' };
export type CalendarEnableResult = 'enabled' | 'denied' | 'failed';

/** Settings.ai patch for a provider choice (DeepSeek is the OpenAI provider plus a base URL). */
export function buildAiSettingsPatch(choice: OnboardingProviderChoice) {
    if (choice === 'deepseek') {
        return {
            enabled: true,
            provider: 'openai' as const,
            baseUrl: DEEPSEEK_BASE_URL,
            model: DEEPSEEK_DEFAULT_MODEL,
            copilotModel: DEEPSEEK_DEFAULT_MODEL,
        };
    }
    return {
        enabled: true,
        provider: 'anthropic' as const,
        baseUrl: '',
        model: getDefaultAIConfig('anthropic').model,
        copilotModel: getDefaultCopilotModel('anthropic'),
        thinkingBudget: getDefaultAIConfig('anthropic').thinkingBudget,
    };
}

export function classifyAiError(error: unknown): 'badKey' | 'network' | 'rateLimit' {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/rate limit|quota|429/i.test(message)) return 'rateLimit';
    if (/invalid|missing|rejected|denied|unauthori[sz]ed|forbidden|401|403|api key|not found|404/i.test(message)) return 'badKey';
    return 'network';
}

/** One minimal request through the shared provider abstraction. The key is never logged or stored here. */
export async function testAiKey(choice: OnboardingProviderChoice, apiKey: string, language: Language = 'en'): Promise<KeyTestResult> {
    try {
        const config = await buildAIConfig({ ai: buildAiSettingsPatch(choice) }, apiKey.trim(), language);
        const provider = createAIProvider({ ...config, timeoutMs: 20_000 });
        if (!provider.generateText) return { ok: false, reason: 'network' };
        const text = await provider.generateText({ system: 'Reply with the single word: ok', user: 'ping' });
        return typeof text === 'string' ? { ok: true } : { ok: false, reason: 'network' };
    } catch (error) {
        return { ok: false, reason: classifyAiError(error) };
    }
}

/** Store the key via the same path as Settings > AI, then switch the Assistant on. */
export async function saveAiChoice(choice: OnboardingProviderChoice, apiKey: string): Promise<void> {
    const patch = buildAiSettingsPatch(choice);
    await saveAIKey(patch.provider, apiKey.trim());
    await updateSettingsFromLatest((settings) => ({ ai: { ...(settings.ai ?? {}), ...patch } }));
}

export async function enableCalendarSync(): Promise<CalendarEnableResult> {
    try {
        const status = await requestSystemCalendarPermission();
        if (status !== 'granted') return 'denied';
        return (await enableDesktopCalendarPush()) ? 'enabled' : 'failed';
    } catch {
        return 'failed';
    }
}

export async function disableCalendarSync(): Promise<void> {
    await setDesktopCalendarPushEnabled(false);
    stopDesktopCalendarPushSync();
}

export type OnboardingServices = {
    testKey: typeof testAiKey;
    saveAi: typeof saveAiChoice;
    generateProposal: typeof generateQuickCaptureProposal;
    applyProposal: typeof applyQuickCapture;
    isAiReady: () => Promise<boolean>;
    seedGuide: (language: Language) => Promise<string | null>;
    getLaunchAtLogin: () => Promise<boolean>;
    setLaunchAtLogin: (enabled: boolean) => Promise<boolean>;
    enableCalendar: () => Promise<CalendarEnableResult>;
    disableCalendar: () => Promise<void>;
};

export const defaultOnboardingServices: OnboardingServices = {
    testKey: testAiKey,
    saveAi: saveAiChoice,
    generateProposal: generateQuickCaptureProposal,
    applyProposal: applyQuickCapture,
    isAiReady: isQuickCaptureAIReady,
    seedGuide: async (language) => (await useTaskStore.getState().seedGettingStarted({ language })).id ?? null,
    getLaunchAtLogin: getLaunchAtStartupEnabled,
    setLaunchAtLogin: setLaunchAtStartupEnabled,
    enableCalendar: enableCalendarSync,
    disableCalendar: disableCalendarSync,
};

export const AI_KEY_LINKS: Record<OnboardingProviderChoice, string> = {
    deepseek: 'https://platform.deepseek.com/api_keys',
    claude: 'https://console.anthropic.com/settings/keys',
};
