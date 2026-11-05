import { tFallback } from '@stride/core';
import { useCallback } from 'react';
import { useLanguage } from '../../contexts/language-context';

/** English source for every onboarding string. The same keys live in packages/core en.ts. */
export const ONBOARDING_COPY = {
    'onboarding.flow.stepOf': 'Step {{current}} of {{total}}',
    'onboarding.flow.back': 'Back',
    'onboarding.flow.next': 'Next',
    'onboarding.flow.skipSetup': 'Skip setup',
    'onboarding.flow.leaveTitle': 'Leave setup?',
    'onboarding.flow.leaveBody': 'What you typed on this step will not be saved.',
    'onboarding.flow.keepGoing': 'Keep going',
    'onboarding.flow.leave': 'Leave setup',
    'onboarding.welcome.title': 'Welcome to Stride',
    'onboarding.welcome.idea': 'Get everything out of your head, and the Assistant sorts it for you.',
    'onboarding.welcome.steps': 'Capture, clarify, organise, reflect, engage. Stride follows the Getting Things Done way, so you can stop holding it all in your mind.',
    'onboarding.welcome.start': 'Get started',
    'onboarding.welcome.haveData': 'Already have data?',
    'onboarding.welcome.syncLink': 'Set up sync',
    'onboarding.welcome.importLink': 'Import',
    'onboarding.welcome.tribute': 'Built on the ideas of Getting Things Done by David Allen.',
    'onboarding.welcome.mind': 'Mind like water.',
    'onboarding.ai.title': 'Connect the Assistant',
    'onboarding.ai.intro': 'Add an API key so Stride can sort your thoughts into tasks. Your key stays on this Mac.',
    'onboarding.ai.optional': 'Optional',
    'onboarding.ai.providerLabel': 'AI provider',
    'onboarding.ai.keyLabel': 'API key',
    'onboarding.ai.keyPlaceholder': 'Paste your key here',
    'onboarding.ai.getKey': 'Get a key',
    'onboarding.ai.test': 'Test key',
    'onboarding.ai.testing': 'Testing…',
    'onboarding.ai.ok': 'Your key works.',
    'onboarding.ai.badKey': 'That key was not accepted. Check that you copied all of it and that it is for {{provider}}.',
    'onboarding.ai.network': 'Could not reach {{provider}}. Check your internet connection and try again.',
    'onboarding.ai.rateLimit': 'The key is valid, but {{provider}} says you are over its limit. Check your balance there.',
    'onboarding.ai.saveFailed': 'Could not save the key. Try again, or skip and add it in Settings.',
    'onboarding.ai.skip': 'Skip for now: you can add a key later in Settings > AI',
    'onboarding.sweep.title': 'First mind sweep',
    'onboarding.sweep.prompt': "What's on your mind? Type or dictate everything: tasks, ideas, worries.",
    'onboarding.sweep.placeholder': 'Call the dentist, plan mum’s birthday, finish the report…',
    'onboarding.sweep.hintManual': 'Without the Assistant, each line becomes an Inbox task.',
    'onboarding.sweep.hintKey': 'Press ⌘ Enter to continue.',
    'onboarding.sweep.skip': 'Skip',
    'onboarding.sweep.organising': 'Sorting your thoughts…',
    'onboarding.sweep.reviewTitle': 'Here is what I found',
    'onboarding.sweep.manualNote': 'Each line is an Inbox task for now. The Assistant will sort them once you add a key in Settings > AI.',
    'onboarding.sweep.failedNote': 'The Assistant could not sort this, so each line is an Inbox task.',
    'onboarding.sweep.include': 'Include',
    'onboarding.sweep.taskTitle': 'Task title',
    'onboarding.sweep.kind': 'Type',
    'onboarding.sweep.empty': 'Nothing to add.',
    'onboarding.sweep.guide': 'Also add a short guide project',
    'onboarding.sweep.add': 'Add to Stride',
    'onboarding.sweep.adding': 'Adding…',
    'onboarding.sweep.addFailed': 'Some items could not be added. You can retry or skip.',
    'onboarding.custom.title': 'Make it yours',
    'onboarding.custom.intro': 'All optional. Each switch applies right away, and you can change it later in Settings.',
    'onboarding.custom.login': 'Open Stride at login',
    'onboarding.custom.loginDesc': 'Start Stride when you sign in to your Mac.',
    'onboarding.custom.calendar': 'Sync tasks to your calendar',
    'onboarding.custom.calendarDesc': 'Scheduled tasks appear in a Stride calendar. macOS will ask for permission.',
    'onboarding.custom.calendarDenied': 'Calendar access was not allowed. You can allow it in System Settings > Privacy & Security > Calendars.',
    'onboarding.custom.calendarOn': 'Calendar sync is on.',
    'onboarding.custom.failed': 'That did not work. You can try again in Settings.',
    'onboarding.custom.accent': 'The accent colour follows System Settings > Appearance.',
    'onboarding.done.title': "You're set",
    'onboarding.done.tipCapture': 'Capture anything, anywhere',
    'onboarding.done.tipAssistant': 'Ask the Assistant',
    'onboarding.done.tipPlaces': 'Inbox holds new thoughts, Focus shows what to do today, and Settings is in the sidebar.',
    'onboarding.done.open': 'Open Stride',
    'settings.replayWelcome': 'Replay welcome tour',
    'settings.replayWelcomeDesc': 'Walk through the first-run setup again.',
} as const;

export type OnboardingCopyKey = keyof typeof ONBOARDING_COPY;

export function useOnboardingCopy() {
    const { t } = useLanguage();
    return useCallback((key: OnboardingCopyKey, vars?: Record<string, string | number>): string => {
        let text = tFallback(t, key, ONBOARDING_COPY[key]);
        if (vars) {
            for (const [name, value] of Object.entries(vars)) text = text.split(`{{${name}}}`).join(String(value));
        }
        return text;
    }, [t]);
}
