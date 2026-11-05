import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    formatPomodoroClock,
    formatPomodoroOvertime,
    getPomodoroOvertimeProgress,
    isPomodoroInOvertime,
    getPomodoroFocusSessionsCompletedToday,
    getPomodoroPhaseTotalSeconds,
    getPomodoroPresetOptions,
    isTaskActionable,
    PomodoroAutoStartOptions,
    resetPomodoroState,
    Task,
    translateWithFallback,
    useTaskStore,
} from '@stride/core';
import { Play, Pause, RotateCcw, Check, ChevronDown, ChevronUp, Flame, Maximize2, PictureInPicture2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../contexts/language-context';
import { reconcilePomodoroSnapshot, togglePomodoroSnapshot, usePomodoroStore } from '../../store/pomodoro-store';
import { useUiStore } from '../../store/ui-store';
import { useFocusSessionStore } from '../../store/focus-session-store';
import { useFocusFloatStore } from '../../store/focus-float-store';
import { isFocusFloatSupported } from '../focus/useFocusFloatBridge';
import { rectOf } from '../focus/focus-anchors';
import { getFocusStreak } from '../../lib/focus-streak';
import { Reveal } from '../ui/Reveal';
import { PomodoroRing } from './PomodoroRing';
import { PomodoroPresetPopover } from './PomodoroPresetPopover';
import { PomodoroTaskPicker } from './PomodoroTaskPicker';
import { beginCompletion, cancelCompletion } from '../../lib/completion-sequence';

export { DESKTOP_POMODORO_SESSION_STORAGE_KEY } from '../../store/pomodoro-store';

interface PomodoroPanelProps {
    tasks: Task[];
}

export function PomodoroPanel({ tasks }: PomodoroPanelProps) {
    const updateTask = useTaskStore((state) => state.updateTask);
    const customDurations = useTaskStore((state) => state.settings.gtd?.pomodoro?.customDurations);

    const liveTasks = useTaskStore((state) => state.tasks);
    const actionableTasksById = useMemo(
        () => new Map(liveTasks.filter(isTaskActionable).map((task) => [task.id, task])),
        [liveTasks]
    );
    const autoStartBreaks = useTaskStore((state) => state.settings.gtd?.pomodoro?.autoStartBreaks === true);
    const autoStartFocus = useTaskStore((state) => state.settings.gtd?.pomodoro?.autoStartFocus === true);
    const { t } = useLanguage();
    const autoStartOptions = useMemo<PomodoroAutoStartOptions>(
        () => ({ autoStartBreaks, autoStartFocus }),
        [autoStartBreaks, autoStartFocus]
    );
    const resolveText = useCallback((key: string, fallback: string) => {
        return translateWithFallback(t, key, fallback);
    }, [t]);
    const snapshot = usePomodoroStore((state) => state.snapshot);
    const collapsed = usePomodoroStore((state) => state.collapsed);
    const setCollapsed = usePomodoroStore((state) => state.setPomodoroCollapsed);
    const hydratePomodoro = usePomodoroStore((state) => state.hydratePomodoro);
    const commitSnapshot = usePomodoroStore((state) => state.commitPomodoro);

    useEffect(() => {

        hydratePomodoro(autoStartOptions);
    }, []);

    useEffect(() => {
        if (!snapshot.selectedTaskId) return;
        if (actionableTasksById.has(snapshot.selectedTaskId)) return;
        commitSnapshot((prev) => ({ ...prev, selectedTaskId: undefined }));
    }, [commitSnapshot, snapshot.selectedTaskId, actionableTasksById]);


    const durations = snapshot.durations;
    const timerState = snapshot.timerState;
    const selectedTaskId = snapshot.selectedTaskId;
    const lastEvent = snapshot.lastEvent;

    const selectedTask = selectedTaskId ? actionableTasksById.get(selectedTaskId) : undefined;


    const pickerTasks = useMemo(() => {
        const focusTasks = tasks.flatMap((task) => {
            const liveTask = actionableTasksById.get(task.id);
            return liveTask ? [liveTask] : [];
        });
        return selectedTask && !focusTasks.some((task) => task.id === selectedTask.id)
            ? [selectedTask, ...focusTasks]
            : focusTasks;
    }, [actionableTasksById, selectedTask, tasks]);
    const presetOptions = useMemo(() => getPomodoroPresetOptions(customDurations), [customDurations]);

    const phaseLabel = timerState.phase === 'focus'
        ? resolveText('pomodoro.phaseFocusShort', 'Focus')
        : resolveText('pomodoro.phaseBreakShort', 'Break');
    const cardTitle = resolveText('pomodoro.title', 'Pomodoro Focus');
    const sessionCountLabel = resolveText('pomodoro.sessionsDone', 'Focus sessions completed');
    const switchPhaseLabel = timerState.phase === 'focus'
        ? resolveText('pomodoro.switchToBreak', 'Switch to Break')
        : resolveText('pomodoro.switchToFocus', 'Switch to Focus');
    const markDoneLabel = resolveText('pomodoro.markTaskDone', 'Mark task done');
    const noTaskLabel = resolveText('pomodoro.noTask', 'No available focus task');
    const selectedTaskLabel = resolveText('pomodoro.selectedTask', 'Timer task');
    const timerOnlyLabel = resolveText('pomodoro.timerOnly', 'Timer only');
    const focusDoneLabel = resolveText('pomodoro.focusComplete', 'Focus session complete. Take a short break.');
    const breakDoneLabel = resolveText('pomodoro.breakComplete', 'Break complete. Ready for the next focus session.');
    const collapseLabel = resolveText('pomodoro.collapse', 'Collapse timer');
    const expandLabel = resolveText('pomodoro.expand', 'Expand timer');
    const searchTaskLabel = resolveText('common.search', 'Search');
    const noMatchesLabel = resolveText('common.noMatches', 'No matches');

    const handleApplyPreset = (focusMinutes: number, breakMinutes: number) => {
        const nextDurations = { focusMinutes, breakMinutes };
        commitSnapshot((prev) => {
            const reconciled = reconcilePomodoroSnapshot(prev, Date.now(), autoStartOptions);
            return {
                ...reconciled,
                durations: nextDurations,
                timerState: resetPomodoroState(reconciled.timerState, nextDurations, reconciled.timerState.phase),
                lastEvent: null,
                updatedAtMs: Date.now(),
            };
        });
    };

    const sectionRef = useRef<HTMLElement>(null);
    const sessionOpen = useFocusSessionStore((state) => state.open);
    const sessionPresentation = useFocusSessionStore((state) => state.presentation);
    const expandSession = useFocusSessionStore((state) => state.expand);
    const floatVisible = useFocusFloatStore((state) => state.visible);

    const handleToggleRun = () => {
        // Every Start opens the focus stage, which grows out of this card.
        if (!timerState.isRunning) {
            useFocusSessionStore.getState().setOrigin(rectOf(sectionRef.current));
        }
        // In overtime, Pause ends the session and the check-in follows.
        commitSnapshot((prev) => togglePomodoroSnapshot(prev, Date.now(), autoStartOptions));
    };

    const handleReset = () => {
        commitSnapshot((prev) => {
            const reconciled = reconcilePomodoroSnapshot(prev, Date.now(), autoStartOptions);
            return {
                ...reconciled,
                timerState: resetPomodoroState(reconciled.timerState, reconciled.durations, reconciled.timerState.phase),
                lastEvent: null,
                updatedAtMs: Date.now(),
            };
        });
    };

    const handleSwitchPhase = () => {
        commitSnapshot((prev) => {
            const reconciled = reconcilePomodoroSnapshot(prev, Date.now(), autoStartOptions);
            return {
                ...reconciled,
                timerState: resetPomodoroState(
                    reconciled.timerState,
                    reconciled.durations,
                    reconciled.timerState.phase === 'focus' ? 'break' : 'focus'
                ),
                lastEvent: null,
                updatedAtMs: Date.now(),
            };
        });
    };

    const handleMarkTaskDone = async () => {
        if (!selectedTask) return;
        if (selectedTask.status !== 'done' && !beginCompletion(selectedTask.id, { sound: true })) return;
        const result = await updateTask(selectedTask.id, { status: 'done', isFocusedToday: false });
        if (result?.success === false) {
            cancelCompletion(selectedTask.id);
            useUiStore.getState().showToast(result.error || t('task.updateFailed'), 'error');
            return;
        }
        commitSnapshot((prev) => ({ ...prev, lastEvent: null }));
    };

    const isFocus = timerState.phase === 'focus';
    const isRunning = timerState.isRunning;
    const sessionsToday = getPomodoroFocusSessionsCompletedToday(snapshot.sessionHistory);
    const streak = useMemo(() => getFocusStreak(), [sessionsToday]);
    const totalSeconds = Math.max(1, getPomodoroPhaseTotalSeconds(timerState, durations));
    const progress = 1 - timerState.remainingSeconds / totalSeconds;
    // Paused part-way through a phase: the only time Reset matters.
    const inProgress = !isRunning && timerState.remainingSeconds < totalSeconds;
    const presetNames: Record<string, string> = {
        quick: resolveText('pomodoro.presetQuick', 'Quick'),
        classic: resolveText('pomodoro.presetClassic', 'Classic'),
        deep: resolveText('pomodoro.presetDeep', 'Deep'),
        custom: resolveText('pomodoro.presetCustom', 'Custom'),
    };
    const activePreset = presetOptions.find(
        (preset) => durations.focusMinutes === preset.focusMinutes && durations.breakMinutes === preset.breakMinutes
    );
    const presetsLabel = resolveText('pomodoro.presetsLabel', 'Session length');
    const pauseLabel = resolveText('common.pause', 'Pause');
    const resetLabel = resolveText('common.reset', 'Reset');

    const [presetsOpen, setPresetsOpen] = useState(false);
    const closePresets = useCallback(() => setPresetsOpen(false), []);
    const clockRef = useRef<HTMLButtonElement>(null);
    /** Wraps both triggers (the clock and the "25 min ⌄" label) so clicks on either are not "outside". */
    const presetAnchorRef = useRef<HTMLDivElement>(null);
    /** Whichever trigger opened the presets gets focus back on Esc. */
    const presetTriggerRef = useRef<HTMLButtonElement | null>(null);
    const togglePresets = (trigger: HTMLButtonElement) => {
        presetTriggerRef.current = trigger;
        setPresetsOpen((open) => !open);
    };
    const phaseMinutes = timerState.phase === 'focus' ? durations.focusMinutes : durations.breakMinutes;
    const presetHint = resolveText('pomodoro.presetHint', 'Focus minutes / break minutes');
    useEffect(() => { if (isRunning) setPresetsOpen(false); }, [isRunning]);

    // One quiet burst on the ring when a phase finishes.
    const [burstKey, setBurstKey] = useState(0);
    const seenEvent = useRef(lastEvent);
    useEffect(() => {
        if (lastEvent && lastEvent !== seenEvent.current) setBurstKey((key) => key + 1);
        seenEvent.current = lastEvent;
    }, [lastEvent]);

    const inOvertime = isPomodoroInOvertime(timerState);
    const clock = inOvertime ? formatPomodoroOvertime(timerState.overtimeSeconds ?? 0) : formatPomodoroClock(timerState.remainingSeconds);
    const overtimeLap = inOvertime ? getPomodoroOvertimeProgress(timerState, durations) : undefined;
    const phaseTextClass = isFocus ? 'text-accent-text' : 'text-success-text';
    const iconButtonClass = 'inline-flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-ring';
    const statusLine = lastEvent === 'focus-finished' ? focusDoneLabel : lastEvent === 'break-finished' ? breakDoneLabel : '';

    if (collapsed) {
        return (
            <section className="rounded-card bg-card px-3 py-2 shadow-soft-sm" aria-label={cardTitle}>
                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <PomodoroRing progress={progress} phase={timerState.phase} size={32} stroke={3.5} well={false} running={isRunning} overtime={overtimeLap} />
                        <p className={cn('fx-display text-xl font-light leading-none tracking-tight tabular-nums', inOvertime && 'text-muted-foreground')}>{clock}</p>
                        <span className={cn('text-[13px] font-medium', phaseTextClass)}>{phaseLabel}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setCollapsed(false)}
                        aria-label={expandLabel}
                        title={expandLabel}
                        className={cn(iconButtonClass, 'h-8 w-8 shrink-0')}
                    >
                        <ChevronDown className="h-4 w-4" aria-hidden />
                    </button>
                </div>
            </section>
        );
    }

    return (
        <section
            ref={sectionRef}
            className="[container-type:inline-size] group/pomo relative rounded-card bg-card px-5 py-5 shadow-soft-sm"
            data-phase={timerState.phase}
            data-running={isRunning ? 'true' : 'false'}
            aria-label={cardTitle}
        >
            {!isRunning && (
                <button
                    type="button"
                    onClick={() => setCollapsed(true)}
                    aria-label={collapseLabel}
                    title={collapseLabel}
                    className={cn(
                        iconButtonClass,
                        'pomo-fade absolute right-3 top-3 h-7 w-7 opacity-0 group-hover/pomo:opacity-100 focus-visible:opacity-100',
                    )}
                >
                    <ChevronUp className="h-4 w-4" aria-hidden />
                </button>
            )}

            <div className="flex flex-col items-center gap-4 [@container_(min-width:30rem)]:flex-row [@container_(min-width:30rem)]:gap-8 [@container_(min-width:30rem)]:pl-2">
                <div ref={presetAnchorRef} className="relative shrink-0">
                    <PomodoroRing progress={progress} phase={timerState.phase} size={148} stroke={5} well={false} running={isRunning} burstKey={burstKey} overtime={overtimeLap}>
                        {isRunning ? (
                            <p
                                className={cn('fx-display text-[44px] font-extralight leading-none tracking-[-0.04em] tabular-nums', inOvertime && 'text-muted-foreground')}
                                data-testid="pomodoro-clock"
                                data-overtime={inOvertime ? 'true' : undefined}
                            >
                                {clock}
                            </p>
                        ) : (
                            <button
                                ref={clockRef}
                                type="button"
                                onClick={(event) => togglePresets(event.currentTarget)}
                                aria-label={presetsLabel}
                                aria-haspopup="true"
                                aria-expanded={presetsOpen}
                                title={presetsLabel}
                                className="rounded-control px-2 py-1 transition-colors hover:bg-foreground/5 focus-ring"
                            >
                                <span className="fx-display block text-[44px] font-extralight leading-none tracking-[-0.04em] tabular-nums" data-testid="pomodoro-clock">
                                    {clock}
                                </span>
                            </button>
                        )}
                        {!isRunning ? (
                            <button
                                type="button"
                                onClick={handleSwitchPhase}
                                aria-label={switchPhaseLabel}
                                title={switchPhaseLabel}
                                className={cn('mt-1 rounded-pill px-2 py-0.5 text-[12px] font-medium transition-colors hover:bg-foreground/5 focus-ring', phaseTextClass)}
                            >
                                {phaseLabel}
                            </button>
                        ) : !isFocus ? (
                            <span className={cn('mt-1.5 text-[12px] font-medium', phaseTextClass)}>{phaseLabel}</span>
                        ) : inOvertime ? (
                            <span className="mt-1.5 text-[12px] font-medium text-muted-foreground" data-testid="pomodoro-overtime">
                                {resolveText('focus.overtimeShort', 'Over time')}
                            </span>
                        ) : null}
                        {!isRunning && (
                            <button
                                type="button"
                                onClick={(event) => togglePresets(event.currentTarget)}
                                aria-haspopup="true"
                                aria-expanded={presetsOpen}
                                title={`${presetsLabel}: ${presetHint}`}
                                data-testid="pomodoro-preset-label"
                                className="mt-0.5 inline-flex items-center gap-0.5 rounded-pill px-2 py-0.5 text-[12px] font-medium tabular-nums text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-ring"
                            >
                                {resolveText('pomodoro.presetMinutes', '{{count}} min').replace('{{count}}', String(phaseMinutes))}
                                <ChevronDown className="h-3 w-3" aria-hidden />
                                <span className="sr-only">, {presetsLabel}</span>
                            </button>
                        )}
                    </PomodoroRing>
                    <PomodoroPresetPopover
                        open={presetsOpen && !isRunning}
                        onClose={closePresets}
                        anchorRef={presetAnchorRef}
                        focusRef={presetTriggerRef}
                        hint={presetHint}
                        ariaLabel={presetsLabel}
                        activeId={activePreset?.id}
                        presets={presetOptions.map((preset) => ({ id: preset.id, name: presetNames[preset.id] ?? preset.label, value: preset.label }))}
                        onPick={(id) => {
                            const preset = presetOptions.find((option) => option.id === id);
                            if (preset) handleApplyPreset(preset.focusMinutes, preset.breakMinutes);
                        }}
                        className="left-1/2 top-[66%] -translate-x-1/2"
                    />
                </div>

                <div className="flex w-full min-w-0 flex-1 flex-col items-center [@container_(min-width:30rem)]:items-start">
                <Reveal open={!isRunning} className="w-full">
                    <div className="flex flex-col items-center gap-3 [@container_(min-width:30rem)]:items-start">
                        {(sessionsToday > 0 || streak > 0) && (
                            <div className="flex items-center gap-2" data-testid="pomodoro-sessions">
                                {sessionsToday > 0 && (
                                    <span className="flex items-center gap-1" title={`${sessionCountLabel}: ${sessionsToday}`}>
                                        {Array.from({ length: Math.min(8, sessionsToday) }, (_, index) => (
                                            <span key={index} aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent-fill/70" />
                                        ))}
                                        <span className="sr-only">{sessionCountLabel}: {sessionsToday}</span>
                                    </span>
                                )}
                                {streak > 0 && (
                                    <span
                                        className="inline-flex items-center gap-0.5 text-[12px] tabular-nums text-muted-foreground"
                                        title={resolveText('focus.streak', 'Day streak')}
                                    >
                                        <Flame className="h-3 w-3" aria-hidden />
                                        {streak}
                                        <span className="sr-only">{resolveText('focus.streak', 'Day streak')}</span>
                                    </span>
                                )}
                            </div>
                        )}

                        <div className="relative w-full max-w-[22rem] px-8 [@container_(min-width:30rem)]:max-w-none [@container_(min-width:30rem)]:px-0 [@container_(min-width:30rem)]:pr-9">
                            <PomodoroTaskPicker
                                tasks={pickerTasks}
                                selectedTaskId={selectedTaskId}
                                onSelect={(nextId) => {
                                    commitSnapshot((prev) => ({ ...prev, selectedTaskId: nextId }));
                                }}
                                label={selectedTaskLabel}
                                placeholder={resolveText('pomodoro.chooseTask', 'Choose a task')}
                                timerOnlyLabel={timerOnlyLabel}
                                noTaskLabel={noTaskLabel}
                                searchPlaceholder={searchTaskLabel}
                                noMatchesLabel={noMatchesLabel}
                            />
                            {selectedTask && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void handleMarkTaskDone();
                                    }}
                                    title={markDoneLabel}
                                    aria-label={markDoneLabel}
                                    className={cn(
                                        iconButtonClass,
                                        'pomo-fade absolute inset-y-0 right-0 my-auto h-7 w-7 opacity-0 hover:text-success-text group-hover/pomo:opacity-100 focus-visible:opacity-100',
                                    )}
                                >
                                    <Check className="h-4 w-4" aria-hidden />
                                </button>
                            )}
                        </div>

                        <div className="relative flex">
                            <button
                                type="button"
                                onClick={handleToggleRun}
                                className="btn-gradient inline-flex h-10 min-w-[8.5rem] items-center justify-center gap-2 px-6 text-[15px] focus-ring"
                            >
                                <Play className="h-4 w-4" aria-hidden />
                                {resolveText('common.start', 'Start')}
                            </button>
                            {inProgress && (
                                <button
                                    type="button"
                                    onClick={handleReset}
                                    aria-label={resetLabel}
                                    title={resetLabel}
                                    className={cn(iconButtonClass, 'pomo-in absolute inset-y-0 left-full my-auto ml-2 h-9 w-9')}
                                >
                                    <RotateCcw className="h-4 w-4" aria-hidden />
                                </button>
                            )}
                        </div>

                        {lastEvent && (
                            <button
                                type="button"
                                onClick={handleSwitchPhase}
                                className="pomo-in rounded-control px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-ring"
                            >
                                {switchPhaseLabel}
                            </button>
                        )}
                    </div>
                </Reveal>

                <Reveal open={isRunning} className="w-full">
                    <div className="flex flex-col items-center gap-3 [@container_(min-width:30rem)]:items-start">
                        {selectedTask && (
                            <p className="line-clamp-2 max-w-[22rem] break-words text-center text-[15px] font-semibold [@container_(min-width:30rem)]:max-w-none [@container_(min-width:30rem)]:text-left" title={selectedTask.title}>
                                {selectedTask.title}
                            </p>
                        )}
                        <button
                            type="button"
                            onClick={handleToggleRun}
                            aria-label={inOvertime ? resolveText('focus.pauseCheckIn', 'Pause and check in') : pauseLabel}
                            title={inOvertime ? resolveText('focus.pauseCheckIn', 'Pause and check in') : pauseLabel}
                            className={cn(iconButtonClass, 'h-11 w-11 bg-well shadow-soft-inset')}
                        >
                            <Pause className="h-4 w-4" aria-hidden />
                        </button>
                    </div>
                </Reveal>

                {sessionOpen && sessionPresentation !== 'full' && (
                    <button
                        type="button"
                        onClick={expandSession}
                        className="pomo-in mt-3 inline-flex h-9 items-center gap-2 rounded-control px-3 text-[14px] font-medium text-accent-text transition-colors hover:bg-accent-soft focus-ring"
                        data-testid="pomodoro-back-to-focus"
                    >
                        <Maximize2 className="h-4 w-4" aria-hidden />
                        {resolveText('focus.backToFocus', 'Back to focus')}
                    </button>
                )}
                {sessionOpen && sessionPresentation !== 'full' && !floatVisible && isFocusFloatSupported() && (
                    <button
                        type="button"
                        onClick={() => useFocusFloatStore.getState().request()}
                        className="pomo-in mt-1 inline-flex h-9 items-center gap-2 rounded-control px-3 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-ring"
                        data-testid="pomodoro-float-timer"
                    >
                        <PictureInPicture2 className="h-4 w-4" aria-hidden />
                        {resolveText('focus.floatShort', 'Float timer')}
                    </button>
                )}
                </div>
            </div>

            <p className="sr-only" role="status" aria-live="polite">{statusLine}</p>
        </section>
    );
}
