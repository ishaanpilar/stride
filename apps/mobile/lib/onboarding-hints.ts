import { workspaceSessionStorage as AsyncStorage } from '@/lib/workspace-session-storage';
import type { OnboardingTopic } from '@stride/core';

// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
const prefix = 'mindwtr:mobile:onboarding-hint:v1:';
const dismissedThisSession = new Set<OnboardingTopic>();

export async function isMobileHintDismissed(topic: OnboardingTopic): Promise<boolean> {
    if (dismissedThisSession.has(topic)) return true;
    try {
        const value = await AsyncStorage.getItem(prefix + topic);

        return dismissedThisSession.has(topic) || value === 'dismissed';
    } catch {
        return dismissedThisSession.has(topic);
    }
}

export async function dismissMobileHint(topic: OnboardingTopic): Promise<void> {
    dismissedThisSession.add(topic);
    try {
        await AsyncStorage.setItem(prefix + topic, 'dismissed');
    } catch {

    }
}
