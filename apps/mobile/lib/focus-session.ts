import { isTaskActionable, type PomodoroAutoStartOptions, type PomodoroEvent, type Task } from '@stride/core';
import type { createMobilePomodoroController } from './pomodoro-controller';
import { focusSessionStore, type FocusPresentation } from './focus-session-store';

type Controller = Pick<
    ReturnType<typeof createMobilePomodoroController>,
    'ensureHydrated' | 'getSnapshot' | 'clearLastEvent' | 'setSelectedTaskId' | 'switchPhase' | 'toggle'
>;

export type StartFocusResult = 'started' | 'switched' | 'not-actionable';

export async function startFocusSession(
    controller: Controller,
    task: Pick<Task, 'id' | 'status' | 'deletedAt'> | undefined,
    autoStart: PomodoroAutoStartOptions,
    presentation: FocusPresentation,
): Promise<StartFocusResult> {
    if (!task || !isTaskActionable(task)) return 'not-actionable';
    await controller.ensureHydrated(autoStart);
    controller.clearLastEvent(autoStart);
    const before = controller.getSnapshot();
    if (before.timerState.phase === 'break') controller.switchPhase(autoStart);
    controller.setSelectedTaskId(task.id, autoStart);
    const current = controller.getSnapshot();
    const alreadyRunning = current.timerState.isRunning && current.timerState.phase === 'focus';
    if (!alreadyRunning) controller.toggle(autoStart);
    focusSessionStore.open(presentation);
    return alreadyRunning && before.selectedTaskId !== task.id ? 'switched' : 'started';
}

export function secondsLeft(phaseEndsAt: string | undefined, fallbackSeconds: number, nowMs: number): number {
    if (!phaseEndsAt) return fallbackSeconds;
    const endMs = new Date(phaseEndsAt).getTime();
    if (!Number.isFinite(endMs)) return fallbackSeconds;
    return Math.max(0, Math.ceil((endMs - nowMs) / 1000));
}

export type FocusView = 'focus' | 'break' | 'ready' | 'finish';

export function deriveFocusView(input: {
    phase: 'focus' | 'break';
    isRunning: boolean;
    /** 'focus-overtime' (desktop "Keep going") keeps the focus view; mobile never enables it. */
    lastEvent: PomodoroEvent | null;
    stepsDone: number;
    stepsTotal: number;
    celebrationAck: boolean;
    breakSkipped: boolean;
}): FocusView {
    const allStepsDone = input.phase === 'focus' && input.stepsTotal > 0 && input.stepsDone === input.stepsTotal && !input.celebrationAck;
    if (input.lastEvent === 'focus-finished' || allStepsDone) return 'finish';
    if (input.phase === 'break') return 'break';
    if ((input.lastEvent === 'break-finished' || input.breakSkipped) && !input.isRunning) return 'ready';
    return 'focus';
}

export function moveToPhase(
    controller: Pick<Controller, 'getSnapshot' | 'clearLastEvent' | 'switchPhase' | 'toggle'>,
    phase: 'focus' | 'break',
    run: boolean,
    autoStart: PomodoroAutoStartOptions,
): void {
    controller.clearLastEvent(autoStart);
    if (controller.getSnapshot().timerState.phase !== phase) controller.switchPhase(autoStart);
    const running = controller.getSnapshot().timerState.isRunning;
    if (run !== running) controller.toggle(autoStart);
}
