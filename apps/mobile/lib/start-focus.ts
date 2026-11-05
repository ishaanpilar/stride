import { useTaskStore } from '@stride/core';
import { focusSessionStore } from './focus-session-store';
import { startFocusSession, type StartFocusResult } from './focus-session';
import { mobilePomodoroController } from './pomodoro-controller';

export type StartFocusMode = 'focus' | 'pomodoro';

export const FOCUS_SESSION_ROUTE = '/focus-session';

export async function startFocusFromTask(taskId: string, mode: StartFocusMode): Promise<StartFocusResult> {
    const { _allTasks, settings } = useTaskStore.getState();
    const pomodoro = settings.gtd?.pomodoro;
    const autoStart = { autoStartBreaks: pomodoro?.autoStartBreaks === true, autoStartFocus: pomodoro?.autoStartFocus === true };
    const task = _allTasks.find((candidate) => candidate.id === taskId);
    const result = await startFocusSession(mobilePomodoroController, task, autoStart, mode === 'focus' ? 'full' : 'mini');
    if (result !== 'not-actionable' && mode === 'focus') {
        const { router } = await import('expo-router');
        router.push(FOCUS_SESSION_ROUTE as never);
    }
    return result;
}

export async function openFocusSession(): Promise<void> {
    focusSessionStore.expand();
    const { router } = await import('expo-router');
    router.push(FOCUS_SESSION_ROUTE as never);
}
