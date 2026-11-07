import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    canAdjustPomodoroPhase,
    formatPomodoroClock,
    formatPomodoroOvertime,
    getPomodoroOvertimeProgress,
    isPomodoroInOvertime,
    getPomodoroPhaseTotalSeconds,
    getPomodoroPresetOptions,
    POMODORO_ADJUST_STEP_MINUTES,
    resetPomodoroState,
    useTaskStore,
    type PomodoroAutoStartOptions,
    type Task,
} from '@stride/core';
import { Check, ChevronDown, Maximize2, Pause, PictureInPicture2, Play, RotateCcw } from 'lucide-react';
import {
    MENUBAR_FOCUS_EXPAND_EVENT,
    MENUBAR_PANEL_SHOWN_EVENT,
    MENUBAR_POMODORO_CHANGED_EVENT,
    notifyMainWindow,
    openMainFromMenuBarPanel,
} from '../../lib/menubar-panel-window';
import { FOCUS_FLOAT_REQUEST_EVENT } from '../../lib/focus-float-window';
import { reportError } from '../../lib/report-error';
import { isTauriRuntime } from '../../lib/runtime';
import { cn } from '../../lib/utils';
import { DESKTOP_POMODORO_SESSION_STORAGE_KEY, reconcilePomodoroSnapshot, togglePomodoroSnapshot, usePomodoroStore } from '../../store/pomodoro-store';
import { readStoredPresentation } from '../../store/focus-session-store';
import { readFocusNow } from '../../lib/focus-coach-store';
import { PomodoroPresetPopover } from '../views/PomodoroPresetPopover';
import { PomodoroRing } from '../views/PomodoroRing';
import { PomodoroAdjust } from '../views/PomodoroAdjust';

interface PanelPomodoroProps {
    candidates: Task[];
    tr: (key: string, fallback: string) => string;
}

/** Tell the main window (which owns ticking, alerts and the float) that the shared snapshot changed. */
export function notifyPomodoroChanged(): void {
    if (!isTauriRuntime()) return;
    void notifyMainWindow(MENUBAR_POMODORO_CHANGED_EVENT)
        .catch((error) => reportError('Failed to notify main window about the timer', error));
}

/**
 * The menu bar panel's timer: one slim row at the bottom. Idle, it offers the session length
 * ("25 min ⌄"), a task and Start. During a session: ring, time, task and Pause.
 */
export function PanelPomodoro({ candidates, tr }: PanelPomodoroProps) {
    const autoStartBreaks = useTaskStore((state) => state.settings.gtd?.pomodoro?.autoStartBreaks === true);
    const autoStartFocus = useTaskStore((state) => state.settings.gtd?.pomodoro?.autoStartFocus === true);
    const customDurations = useTaskStore((state) => state.settings.gtd?.pomodoro?.customDurations);
    const snapshot = usePomodoroStore((state) => state.snapshot);
    const hydrate = usePomodoroStore((state) => state.hydratePomodoro);
    const commit = usePomodoroStore((state) => state.commitPomodoro);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [pickerOpen, setPickerOpen] = useState(false);
    const [presetsOpen, setPresetsOpen] = useState(false);
    const closePresets = useCallback(() => setPresetsOpen(false), []);
    const rootRef = useRef<HTMLDivElement>(null);
    const presetAnchorRef = useRef<HTMLDivElement>(null);
    const presetTriggerRef = useRef<HTMLButtonElement | null>(null);
    const autoStart = useMemo<PomodoroAutoStartOptions>(
        () => ({ autoStartBreaks, autoStartFocus }),
        [autoStartBreaks, autoStartFocus],
    );

    // Re-read the snapshot the other windows saved (localStorage is shared by all of them): when the
    // panel opens, and whenever another window writes it (Pause, "+5" in the float or on the stage).
    useEffect(() => {
        hydrate(autoStart);
        const onStorage = (event: StorageEvent) => {
            if (event.key === null || event.key === DESKTOP_POMODORO_SESSION_STORAGE_KEY) hydrate(autoStart);
        };
        window.addEventListener('storage', onStorage);
        let unlisten: (() => void) | undefined;
        let disposed = false;
        if (isTauriRuntime()) {
            void import('@tauri-apps/api/event').then(async ({ listen }) => {
                const off = await listen(MENUBAR_PANEL_SHOWN_EVENT, () => hydrate(autoStart));
                if (disposed) off(); else unlisten = off;
            });
        }
        return () => {
            disposed = true;
            window.removeEventListener('storage', onStorage);
            unlisten?.();
        };
    }, [autoStart, hydrate]);

    const isRunning = snapshot.timerState.isRunning;
    useEffect(() => {
        if (!isRunning) return;
        setPresetsOpen(false);
        setPickerOpen(false);
        const id = window.setInterval(() => setNowMs(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [isRunning]);

    useEffect(() => {
        if (!pickerOpen) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setPickerOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            // Close the picker first; do not let Esc also hide the whole panel.
            event.stopPropagation();
            event.preventDefault();
            setPickerOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown, true);
        };
    }, [pickerOpen]);

    // Display only: the main window owns ticking, alerts and credits while the timer runs.
    const display = reconcilePomodoroSnapshot(snapshot, nowMs, autoStart).timerState;
    const isFocus = display.phase === 'focus';
    const phase = isFocus ? tr('pomodoro.phaseFocusShort', 'Focus') : tr('pomodoro.phaseBreakShort', 'Break');
    const totalSeconds = Math.max(1, getPomodoroPhaseTotalSeconds(display, snapshot.durations));
    const progress = Math.min(1, Math.max(0, 1 - display.remainingSeconds / totalSeconds));
    const inOvertime = isPomodoroInOvertime(display);
    /** A session exists: counting, or paused part-way through a phase (or after adding time to it). */
    const inSession = isRunning || display.remainingSeconds < totalSeconds || (display.extendedSeconds ?? 0) > 0;

    const apply = useCallback((updater: Parameters<typeof commit>[0]) => {
        commit(updater);
        notifyPomodoroChanged();
    }, [commit]);

    const toggle = () => {
        const starting = !snapshot.timerState.isRunning;
        // In overtime, Pause ends the session; the main window shows the check-in.
        const endsOvertime = starting === false && inOvertime;
        apply((prev) => togglePomodoroSnapshot(prev, Date.now(), autoStart));
        if (endsOvertime) backToFocus();
        // Start from idle shows the full Focus stage in the main window (it opens from the shared snapshot).
        if (starting && !inSession && isTauriRuntime()) {
            void openMainFromMenuBarPanel()
                .then(() => notifyMainWindow(MENUBAR_FOCUS_EXPAND_EVENT))
                .catch((error) => reportError('Failed to show Focus mode', error));
        }
    };

    const reset = () => apply((prev) => {
        const reconciled = reconcilePomodoroSnapshot(prev, Date.now(), autoStart);
        return {
            ...reconciled,
            timerState: resetPomodoroState(reconciled.timerState, reconciled.durations, reconciled.timerState.phase),
            lastEvent: null,
            updatedAtMs: Date.now(),
        };
    });

    const applyPreset = (focusMinutes: number, breakMinutes: number) => apply((prev) => {
        const reconciled = reconcilePomodoroSnapshot(prev, Date.now(), autoStart);
        const durations = { focusMinutes, breakMinutes };
        return {
            ...reconciled,
            durations,
            timerState: resetPomodoroState(reconciled.timerState, durations, reconciled.timerState.phase),
            lastEvent: null,
            updatedAtMs: Date.now(),
        };
    });

    const selectTask = (taskId: string) => {
        apply((prev) => ({ ...prev, selectedTaskId: taskId || undefined }));
        setPickerOpen(false);
    };

    const togglePresets = (trigger: HTMLButtonElement) => {
        presetTriggerRef.current = trigger;
        setPickerOpen(false);
        setPresetsOpen((open) => !open);
    };

    const selectedId = snapshot.selectedTaskId ?? '';
    const options = candidates.some((task) => task.id === selectedId) || !selectedId
        ? candidates
        : [...candidates, ...useTaskStore.getState()._allTasks.filter((task) => task.id === selectedId)];
    const selectedTask = options.find((task) => task.id === selectedId);
    const nowLine = isRunning && isFocus && selectedTask ? readFocusNow(selectedTask.id) : null;
    const timerOnly = tr('pomodoro.timerOnly', 'Timer only');
    const pickerLabel = tr('pomodoro.selectedTask', 'Timer task');
    const presetsLabel = tr('pomodoro.presetsLabel', 'Session length');
    const runLabel = inOvertime && isRunning
        ? tr('focus.pauseCheckIn', 'Pause and check in')
        : isRunning ? tr('common.pause', 'Pause') : tr('focus.resume', 'Resume');
    const resetLabel = tr('common.reset', 'Reset');

    const presetOptions = getPomodoroPresetOptions(customDurations);
    const activePreset = presetOptions.find(
        (preset) => snapshot.durations.focusMinutes === preset.focusMinutes && snapshot.durations.breakMinutes === preset.breakMinutes,
    );
    const presetNames: Record<string, string> = {
        quick: tr('pomodoro.presetQuick', 'Quick'),
        classic: tr('pomodoro.presetClassic', 'Classic'),
        deep: tr('pomodoro.presetDeep', 'Deep'),
        custom: tr('pomodoro.presetCustom', 'Custom'),
    };
    const clock = inOvertime ? formatPomodoroOvertime(display.overtimeSeconds ?? 0) : formatPomodoroClock(display.remainingSeconds);
    const phaseMinutes = Math.round(totalSeconds / 60);
    // "− / +": idle they plan the upcoming session, otherwise they change the current phase. The
    // main window (ticking, float) re-reads the shared snapshot.
    const adjust = (deltaMinutes: number) => {
        const changed = usePomodoroStore.getState().adjustPomodoro(deltaMinutes, autoStart);
        if (changed) notifyPomodoroChanged();
        return changed;
    };
    const clockClass = 'fx-display text-[20px] font-light leading-none tracking-tight tabular-nums';
    // Focus mode in the main window is minimised or hidden: offer the way back from here.
    const presentation = readStoredPresentation();
    const showBackToFocus = presentation !== null && presentation !== 'full' && inSession;
    const backLabel = tr('focus.backToFocus', 'Back to focus');
    const backToFocus = () => {
        if (!isTauriRuntime()) return;
        void openMainFromMenuBarPanel()
            .then(() => notifyMainWindow(MENUBAR_FOCUS_EXPAND_EVENT))
            .catch((error) => reportError('Failed to show Focus mode', error));
    };
    // Pop the timer out over every app; the main window owns the float and shows it.
    const floatLabel = tr('focus.float', 'Float timer over other apps');
    const floatTimer = () => {
        if (!isTauriRuntime()) return;
        void notifyMainWindow(FOCUS_FLOAT_REQUEST_EVENT)
            .catch((error) => reportError('Failed to float the timer', error));
    };
    const smallIcon = 'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-ring';

    return (
        <section
            ref={rootRef}
            aria-label={tr('pomodoro.title', 'Pomodoro Focus')}
            data-phase={display.phase}
            data-running={isRunning ? 'true' : 'false'}
            data-session={inSession ? 'true' : 'false'}
            data-testid="panel-pomodoro"
            className="relative border-t border-border bg-foreground/[0.03] px-3 py-2.5"
        >
            <div className="flex items-center gap-2.5">
                <PomodoroRing
                    progress={inSession ? progress : 0}
                    phase={display.phase}
                    size={34}
                    stroke={3}
                    well={false}
                    running={isRunning}
                    overtime={inOvertime ? getPomodoroOvertimeProgress(display, snapshot.durations) : undefined}
                />

                {inSession ? (
                    <span className={cn(clockClass, inOvertime && 'text-muted-foreground')} data-testid="panel-pomodoro-clock" data-overtime={inOvertime ? 'true' : undefined}>{clock}</span>
                ) : null}
                {!inSession && (
                    <div ref={presetAnchorRef} className="flex flex-col items-start">
                        <button
                            type="button"
                            onClick={(event) => togglePresets(event.currentTarget)}
                            aria-label={presetsLabel}
                            aria-haspopup="true"
                            aria-expanded={presetsOpen}
                            title={presetsLabel}
                            className="-mx-1 rounded-md px-1 transition-colors hover:bg-foreground/5 focus-ring"
                        >
                            <span className={clockClass} data-testid="panel-pomodoro-clock">{clock}</span>
                        </button>
                        <button
                            type="button"
                            onClick={(event) => togglePresets(event.currentTarget)}
                            aria-haspopup="true"
                            aria-expanded={presetsOpen}
                            title={presetsLabel}
                            data-testid="panel-pomodoro-preset-label"
                            className="-mx-1 mt-0.5 inline-flex items-center gap-0.5 rounded-md px-1 text-[12px] font-medium tabular-nums leading-4 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-ring"
                        >
                            {tr('pomodoro.presetMinutes', '{{count}} min').replace('{{count}}', String(phaseMinutes))}
                            <ChevronDown className="h-3 w-3" aria-hidden />
                            <span className="sr-only">, {presetsLabel}</span>
                        </button>
                    </div>
                )}
                <PomodoroAdjust
                    size="sm"
                    tr={tr}
                    canDecrease={canAdjustPomodoroPhase(display, snapshot.durations, -POMODORO_ADJUST_STEP_MINUTES)}
                    canIncrease={canAdjustPomodoroPhase(display, snapshot.durations, POMODORO_ADJUST_STEP_MINUTES)}
                    onAdjust={adjust}
                    className="-ml-1"
                    testId="panel-pomodoro-adjust"
                />

                <div className="min-w-0 flex-1">
                    {inSession ? (
                        <>
                            <p className={cn('truncate text-[13px]', isFocus ? 'font-medium text-muted-foreground' : 'font-medium text-success-text')} title={selectedTask?.title}>
                                {!isFocus ? phase : selectedTask?.title ?? timerOnly}
                                {!isRunning && <span className="text-tertiary"> · {tr('pomodoro.paused', 'Paused')}</span>}
                                {inOvertime && <span className="text-tertiary"> · {tr('focus.overtimeShort', 'Over time')}</span>}
                            </p>
                            {nowLine && (
                                <p className="truncate text-[12px] text-tertiary" title={nowLine} data-testid="panel-focus-step">
                                    {tr('focus.panelStep', 'Now')}: {nowLine}
                                </p>
                            )}
                        </>
                    ) : (
                        <button
                            type="button"
                            aria-label={pickerLabel}
                            aria-haspopup="listbox"
                            aria-expanded={pickerOpen}
                            onClick={() => { setPresetsOpen(false); setPickerOpen((open) => !open); }}
                            title={selectedTask?.title}
                            className="-ml-1.5 flex max-w-full items-center rounded-control px-1.5 py-1 text-left transition-colors hover:bg-well focus-ring"
                        >
                            <span className={cn('truncate text-[13px]', selectedTask ? 'font-semibold' : 'text-muted-foreground')}>
                                {selectedTask?.title ?? tr('pomodoro.chooseTask', 'Choose a task')}
                            </span>
                        </button>
                    )}
                </div>

                {inSession && (
                    <button type="button" onClick={floatTimer} aria-label={floatLabel} title={floatLabel} className={cn(smallIcon, 'h-7 w-7')} data-testid="panel-float-timer">
                        <PictureInPicture2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                )}
                {showBackToFocus && (
                    <button type="button" onClick={backToFocus} aria-label={backLabel} title={backLabel} className={cn(smallIcon, 'h-7 w-7')} data-testid="panel-back-to-focus">
                        <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                )}
                {inSession && !isRunning && (
                    <button type="button" onClick={reset} aria-label={resetLabel} title={resetLabel} className={cn(smallIcon, 'h-7 w-7 pomo-in')}>
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    </button>
                )}
                {inSession ? (
                    <button
                        key="run"
                        type="button"
                        onClick={toggle}
                        aria-label={runLabel}
                        title={runLabel}
                        className="pomo-in inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-well text-foreground shadow-soft-inset transition-colors hover:bg-accent focus-ring"
                    >
                        {isRunning ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                    </button>
                ) : (
                    <button
                        key="start"
                        type="button"
                        onClick={toggle}
                        className="btn-gradient pomo-in inline-flex h-8 shrink-0 items-center gap-1.5 px-3 text-[13px] focus-ring"
                    >
                        <Play className="h-3.5 w-3.5" aria-hidden />
                        {tr('common.start', 'Start')}
                    </button>
                )}
            </div>

            <PomodoroPresetPopover
                open={presetsOpen && !inSession}
                onClose={closePresets}
                anchorRef={presetAnchorRef}
                focusRef={presetTriggerRef}
                hint={tr('pomodoro.presetHint', 'Focus minutes / break minutes')}
                ariaLabel={presetsLabel}
                activeId={activePreset?.id}
                presets={presetOptions.map((preset) => ({ id: preset.id, name: presetNames[preset.id] ?? preset.label, value: preset.label }))}
                onPick={(id) => {
                    const preset = presetOptions.find((option) => option.id === id);
                    if (preset) applyPreset(preset.focusMinutes, preset.breakMinutes);
                }}
                className="bottom-full left-3 mb-1.5"
            />

            {pickerOpen && (
                <ul
                    role="listbox"
                    aria-label={pickerLabel}
                    className="pomo-pop absolute bottom-full left-3 right-3 z-20 mb-1.5 max-h-52 overflow-y-auto rounded-card bg-popover p-1 text-popover-foreground shadow-soft"
                >
                    {[{ id: '', title: timerOnly }, ...options].map((option) => {
                        const selected = option.id === selectedId;
                        return (
                            <li key={option.id || 'timer-only'} role="option" aria-selected={selected}>
                                <button
                                    type="button"
                                    onClick={() => selectTask(option.id)}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none"
                                >
                                    <Check className={cn('h-3 w-3 shrink-0 text-accent-text', !selected && 'opacity-0')} aria-hidden />
                                    <span className="truncate">{option.title}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
