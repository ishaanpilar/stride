import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyFocusCoachAction,
  buildFocusCoachInputForTask,
  formatPomodoroClock,
  getFallbackEncouragement,
  getFocusMilestone,
  getPomodoroFocusSessionsCompletedToday,
  markFocusTaskDone,
  useFocusCoach,
  useFocusSteps,
  useTaskStore,
  type FocusCoachAction,
  type FocusCoachReply,
  type FocusMilestone,
  type FocusUndo,
} from '@stride/core';
import { useLanguage } from '../../contexts/language-context';
import { useToast } from '../../contexts/toast-context';
import { focusAiService } from '../../lib/focus-ai-service';
import { deriveFocusView, moveToPhase } from '../../lib/focus-session';
import { focusSessionStore } from '../../lib/focus-session-store';
import { focusCoachStore, focusStreakStore, hydrateFocusStorage } from '../../lib/focus-storage';
import { getMotionPreference } from '../../lib/motion-preference';
import { mobilePomodoroController } from '../../lib/pomodoro-controller';
import type { FinishKind } from './FocusFinish';
import { useFocusClock } from './useFocusClock';
import { useFocusText } from './useFocusText';

const COACH_LEAVE_MS = 260;
const BREAK_IDEAS = 4;

const coachServices = {
  ai: focusAiService,
  readFeedbackSummary: focusCoachStore.readFocusCoachFeedbackSummary,
  recordFeedback: focusCoachStore.recordFocusCoachFeedback,
  leaveDelayMs: () => (getMotionPreference() === 'on' ? COACH_LEAVE_MS : 0),
};

export function useFocusSessionHost() {
  const tr = useFocusText();
  const { language } = useLanguage();
  const { showToast } = useToast();
  const clock = useFocusClock(true);
  const { session, autoStart, remainingSeconds, totalSeconds } = clock;
  const { timerState, durations, selectedTaskId, lastEvent, sessionHistory } = session;
  const projects = useTaskStore((state) => state.projects);

  const stepsApi = useFocusSteps(selectedTaskId);
  const { task, steps } = stepsApi;
  const project = task?.projectId ? projects.find((p) => p.id === task.projectId) : undefined;
  const coach = useFocusCoach(coachServices, task?.id, true, language, tr);
  const done = steps.filter((s) => s.isCompleted).length;
  const total = steps.length;

  const [note, setNote] = useState<string | null>(null);
  const [sentence, setSentence] = useState<{ key: string; text: string } | null>(null);
  const [celebrationAck, setCelebrationAck] = useState(false);
  const [breakSkipped, setBreakSkipped] = useState(false);
  const [breakIdea, setBreakIdea] = useState(0);
  const [streak, setStreak] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    void hydrateFocusStorage().then(() => setStreak(focusStreakStore.getFocusStreak()));
  }, []);
  useEffect(() => { setCelebrationAck(false); }, [selectedTaskId]);
  useEffect(() => { if (total === 0 || done < total) setCelebrationAck(false); }, [done, total]);
  useEffect(() => { if (timerState.phase === 'break') setBreakIdea((i) => (i + 1) % BREAK_IDEAS); }, [timerState.phase]);
  useEffect(() => { if (timerState.isRunning) setBreakSkipped(false); }, [timerState.isRunning]);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 3200);
    return () => clearTimeout(timer);
  }, [note]);

  const currentStepTitle = steps.find((s) => !s.isCompleted)?.title;
  const coachLead = coach.status === 'ready' ? coach.coach?.approach?.text : undefined;
  useEffect(() => {
    focusCoachStore.writeFocusNow(task?.id, currentStepTitle ?? coachLead ?? null);
  }, [task?.id, currentStepTitle, coachLead]);
  useEffect(() => () => focusCoachStore.writeFocusNow(undefined, null), []);

  const encourage = useCallback((milestone: FocusMilestone, doneCount: number, totalCount: number, apply: (key: string, text: string) => void) => {
    const key = `${task?.id ?? 'timer'}:${milestone}:${doneCount}`;
    apply(key, tr(`focus.encourage.${milestone}`, getFallbackEncouragement(milestone, doneCount)));
    if (!task) return;
    void focusAiService
      .requestFocusEncouragement(`${task.id}:${milestone}`, { taskTitle: task.title, milestone, done: doneCount, total: totalCount }, language)
      .then((line) => { if (line) apply(key, line); });
  }, [language, task, tr]);

  const previousDone = useRef<{ taskId: string | undefined; done: number } | null>(null);
  useEffect(() => {
    const previous = previousDone.current;
    previousDone.current = { taskId: task?.id, done };
    if (!previous || previous.taskId !== task?.id || done <= previous.done || total === 0) return;
    setAnnouncement(tr('focus.stepAnnounce', 'Step {{current}} of {{total}} done').replace('{{current}}', String(done)).replace('{{total}}', String(total)));
    if (done >= total) {
      encourage('end', done, total, (key, text) => setSentence({ key, text }));
      return;
    }
    const next = steps.find((s) => !s.isCompleted);
    const nextLine = next ? tr('focus.next', 'Next: {{step}}').replace('{{step}}', next.title) : '';
    const milestone = getFocusMilestone(done, total);
    if (milestone) encourage(milestone, done, total, (_key, text) => setNote(`${text} ${nextLine}`.trim()));
    else setNote(nextLine);
  }, [done, total, encourage, steps, tr, task?.id]);

  useEffect(() => {
    if (!timerState.isRunning) return;
    if (remainingSeconds === 300 || remainingSeconds === 60) {
      setAnnouncement(tr('focus.timeLeft', '{{time}} remaining').replace('{{time}}', formatPomodoroClock(remainingSeconds)));
    }
  }, [remainingSeconds, timerState.isRunning, tr]);

  const handledEvent = useRef<typeof lastEvent>(null);
  useEffect(() => {
    if (lastEvent === handledEvent.current) return;
    handledEvent.current = lastEvent;
    if (lastEvent !== 'focus-finished') return;
    void hydrateFocusStorage().then(() => setStreak(focusStreakStore.recordFocusDay()));
    encourage('end', done, total, (key, text) => setSentence({ key, text }));
    focusSessionStore.expand();
  }, [lastEvent, done, total, encourage]);

  const view = deriveFocusView({
    phase: timerState.phase,
    isRunning: timerState.isRunning,
    lastEvent,
    stepsDone: done,
    stepsTotal: total,
    celebrationAck,
    breakSkipped,
  });
  const finishKind: FinishKind = lastEvent === 'focus-finished' ? 'session' : 'task';
  const active = timerState.isRunning || view === 'focus' || view === 'break';
  const elapsedMinutes = Math.max(1, Math.round((totalSeconds - remainingSeconds) / 60));

  const summary = {
    minutes: finishKind === 'session' ? durations.focusMinutes : elapsedMinutes,
    stepsDone: done,
    stepsTotal: total,
    sessionsToday: getPomodoroFocusSessionsCompletedToday(sessionHistory),
    streak,
  };

  const toggleRun = useCallback(() => { mobilePomodoroController.toggle(autoStart); }, [autoStart]);
  const goTo = useCallback((phase: 'focus' | 'break', run: boolean) => {
    moveToPhase(mobilePomodoroController, phase, run, autoStart);
  }, [autoStart]);

  const endSession = useCallback(() => {
    mobilePomodoroController.clearLastEvent(autoStart);
    mobilePomodoroController.reset(autoStart);
    focusSessionStore.close();
  }, [autoStart]);

  const closeFinished = useCallback(() => {
    mobilePomodoroController.clearLastEvent(autoStart);
    focusSessionStore.close();
  }, [autoStart]);

  const markDone = useCallback(async (): Promise<FocusUndo | null> => {
    if (!task) return null;
    const undo = await markFocusTaskDone(task.id);
    if (!undo) {
      showToast({ message: tr('task.updateFailed', 'Could not update the task'), tone: 'error' });
      return null;
    }
    if (mobilePomodoroController.getSnapshot().timerState.isRunning) mobilePomodoroController.toggle(autoStart);
    return undo;
  }, [autoStart, showToast, task, tr]);

  const applyAction = useCallback(
    async (action: FocusCoachAction): Promise<FocusUndo | null> => (task ? applyFocusCoachAction(task.id, action) : null),
    [task],
  );

  const askCoach = useCallback(async (text: string): Promise<FocusCoachReply> => {
    const input = task
      ? buildFocusCoachInputForTask(task.id, focusCoachStore.readFocusCoachFeedbackSummary())
      : null;
    return focusAiService.requestFocusCoachReply(input ?? { title: '', context: {} }, [
      { role: 'coach', text: tr('focus.checkin.blocking', "What's in the way?") },
      { role: 'user', text },
    ], { language, tr });
  }, [language, task, tr]);

  const taskIsDone = () => Boolean(task && useTaskStore.getState()._allTasks.find((x) => x.id === task.id)?.status === 'done');

  return {
    tr,
    clock,
    session,
    view,
    finishKind,
    active,
    task,
    project,
    steps,
    stepsApi,
    coach,
    note,
    sentence: sentence?.text ?? tr('focus.encourage.end', getFallbackEncouragement('end')),
    breakIdea: tr(`focus.breakIdea.${breakIdea}`, 'Stand up and stretch your shoulders.'),
    announcement,
    summary,
    toggleRun,
    endSession,
    closeFinished,
    markDone,
    applyAction,
    askCoach,
    takeBreak: () => { setCelebrationAck(true); goTo('break', true); },
    keepGoing: () => {
      setCelebrationAck(true);
      setSentence(null);
      goTo('focus', true);
    },
    startNext: () => { setNote(null); setBreakSkipped(false); goTo('focus', true); },
    skipBreak: () => { setBreakSkipped(true); goTo('focus', false); },
    checkInBreak: (afterDone: boolean) => {
      setCelebrationAck(true);
      goTo('break', true);
      if (afterDone) mobilePomodoroController.setSelectedTaskId(undefined, autoStart);
    },
    closeFromCheckIn: () => {
      const finished = taskIsDone();
      mobilePomodoroController.clearLastEvent(autoStart);
      if (finished) mobilePomodoroController.setSelectedTaskId(undefined, autoStart);
      goTo('focus', false);
      focusSessionStore.close();
    },
  };
}

export type FocusSessionHost = ReturnType<typeof useFocusSessionHost>;
