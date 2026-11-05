import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useTaskStore, type PomodoroAutoStartOptions } from '@stride/core';
import { mobilePomodoroController, useMobilePomodoroControllerState } from '../../lib/pomodoro-controller';
import { secondsLeft } from '../../lib/focus-session';

export function useFocusAutoStart(): PomodoroAutoStartOptions {
  const autoStartBreaks = useTaskStore((state) => state.settings.gtd?.pomodoro?.autoStartBreaks === true);
  const autoStartFocus = useTaskStore((state) => state.settings.gtd?.pomodoro?.autoStartFocus === true);
  return useMemo(() => ({ autoStartBreaks, autoStartFocus }), [autoStartBreaks, autoStartFocus]);
}

export function useFocusClock(live: boolean) {
  const session = useMobilePomodoroControllerState();
  const autoStart = useFocusAutoStart();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { timerState, durations, phaseEndsAt } = session;

  useEffect(() => {
    if (!live || !timerState.isRunning) return;
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [live, timerState.isRunning]);

  useEffect(() => {
    if (!live) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      setNowMs(Date.now());
      mobilePomodoroController.reconcile(autoStart);
    });
    return () => subscription.remove();
  }, [autoStart, live]);

  const remainingSeconds = timerState.isRunning
    ? secondsLeft(phaseEndsAt, timerState.remainingSeconds, nowMs)
    : timerState.remainingSeconds;
  const totalSeconds = Math.max(1, (timerState.phase === 'focus' ? durations.focusMinutes : durations.breakMinutes) * 60);
  const progress = Math.min(1, Math.max(0, 1 - remainingSeconds / totalSeconds));

  return { session, autoStart, remainingSeconds, totalSeconds, progress };
}
