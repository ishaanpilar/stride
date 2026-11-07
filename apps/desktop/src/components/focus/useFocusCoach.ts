import { useMemo } from 'react';
import { getPomodoroPhaseTotalSeconds, useFocusCoach as useCoreFocusCoach, type Language } from '@stride/core';
import { canAnimate } from '../../lib/motion';
import { requestFocusCoach, requestFocusCoachReply } from '../../lib/focus-ai-service';
import { readFocusCoachFeedbackSummary, recordFocusCoachFeedback } from '../../lib/focus-coach-store';
import { usePomodoroStore } from '../../store/pomodoro-store';

export type { FocusCoachApi, FocusCoachExchange, FocusCoachStatus, StepsState } from '@stride/core';

const LEAVE_MS = 260;

const services = {
    ai: {
        requestFocusCoach: (...args: Parameters<typeof requestFocusCoach>) => requestFocusCoach(...args),
        requestFocusCoachReply: (...args: Parameters<typeof requestFocusCoachReply>) => requestFocusCoachReply(...args),
    },
    readFeedbackSummary: readFocusCoachFeedbackSummary,
    recordFeedback: recordFocusCoachFeedback,
    leaveDelayMs: () => (canAnimate() ? LEAVE_MS : 0),
    // Like a good assistant: a task with no checklist gets the coach's steps written in (with Undo).
    autoAddSteps: true,
    readTimerMinutes: () => {
        const { timerState, durations } = usePomodoroStore.getState().snapshot;
        return timerState.phase === 'focus' ? Math.round(getPomodoroPhaseTotalSeconds(timerState, durations) / 60) : undefined;
    },
};

export function useFocusCoach(taskId: string | undefined, active: boolean, language: Language, tr: (key: string, fallback: string) => string) {
    return useCoreFocusCoach(useMemo(() => services, []), taskId, active, language, tr);
}
