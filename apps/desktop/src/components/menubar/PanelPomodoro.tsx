import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatPomodoroClock, getPomodoroPresetOptions, resetPomodoroState, useTaskStore, type PomodoroAutoStartOptions, type Task } from '@stride/core';
import { Check, Maximize2, Pause, Play, RotateCcw } from 'lucide-react';
import {
    MENUBAR_FOCUS_EXPAND_EVENT,
    MENUBAR_PANEL_SHOWN_EVENT,
    MENUBAR_POMODORO_CHANGED_EVENT,
    notifyMainWindow,
    openMainFromMenuBarPanel,
} from '../../lib/menubar-panel-window';
import { reportError } from '../../lib/report-error';
import { isTauriRuntime } from '../../lib/runtime';
import { cn } from '../../lib/utils';
import { reconcilePomodoroSnapshot, usePomodoroStore } from '../../store/pomodoro-store';
import { readStoredPresentation } from '../../store/focus-session-store';
import { readFocusNow } from '../../lib/focus-coach-store';
import { PomodoroPresetPopover } from '../views/PomodoroPresetPopover';
import { PomodoroRing } from '../views/PomodoroRing';

interface PanelPomodoroProps {
    candidates: Task[];
    tr: (key: string, fallback: string) => string;
}

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
    const clockRef = useRef<HTMLButtonElement>(null);
    const autoStart = useMemo<PomodoroAutoStartOptions>(
        () => ({ autoStartBreaks, autoStartFocus }),
        [autoStartBreaks, autoStartFocus],
    );

    // Re-read the snapshot the main window last saved (localStorage is shared by all windows).
    useEffect(() => {
        hydrate(autoStart);
        if (!isTauriRuntime()) return;
        let unlisten: (() => void) | undefined;
        let disposed = false;
        void import('@tauri-apps/api/event').then(async ({ listen }) => {
            const off = await listen(MENUBAR_PANEL_SHOWN_EVENT, () => hydrate(autoStart));
            if (disposed) off(); else unlisten = off;
        });
        return () => { disposed = true; unlisten?.(); };
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
    const totalSeconds = Math.max(1, (isFocus ? snapshot.durations.focusMinutes : snapshot.durations.breakMinutes) * 60);
    const progress = Math.min(1, Math.max(0, 1 - display.remainingSeconds / totalSeconds));

    const apply = useCallback((updater: Parameters<typeof commit>[0]) => {
        commit(updater);
        if (isTauriRuntime()) {
            void notifyMainWindow(MENUBAR_POMODORO_CHANGED_EVENT)
                .catch((error) => reportError('Failed to notify main window about the timer', error));
        }
    }, [commit]);

    const toggle = () => {
        const starting = !snapshot.timerState.isRunning;
        apply((prev) => {
            const reconciled = reconcilePomodoroSnapshot(prev, Date.now(), autoStart);
            return {
                ...reconciled,
                timerState: { ...reconciled.timerState, isRunning: !reconciled.timerState.isRunning },
                updatedAtMs: Date.now(),
            };
        });
        // Start always shows the full Focus stage in the main window (it opens from the shared snapshot).
        if (starting && isTauriRuntime()) {
            void openMainFromMenuBarPanel()
                .then(() => notifyMainWindow(MENUBAR_FOCUS_EXPAND_EVENT))
                .catch((error) => reportError('Failed to show Focus mode', error));
        }
    };

    const reset = () => apply((prev) => {
        const reconciled = reconcilePomodoroSnapshot(prev, Date.now(), autoStart);
        return {
            ...reconciled,
            timerState: {
                ...reconciled.timerState,
                isRunning: false,
                remainingSeconds: (reconciled.timerState.phase === 'focus' ? reconciled.durations.focusMinutes : reconciled.durations.breakMinutes) * 60,
            },
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

    const selectedId = snapshot.selectedTaskId ?? '';
    const options = candidates.some((task) => task.id === selectedId) || !selectedId
        ? candidates
        : [...candidates, ...useTaskStore.getState()._allTasks.filter((task) => task.id === selectedId)];
    const selectedTask = options.find((task) => task.id === selectedId);
    const nowLine = isRunning && isFocus && selectedTask ? readFocusNow(selectedTask.id) : null;
    const timerOnly = tr('pomodoro.timerOnly', 'Timer only');
    const pickerLabel = tr('pomodoro.selectedTask', 'Timer task');
    const presetsLabel = tr('pomodoro.presetsLabel', 'Session length');
    const pauseLabel = tr('common.pause', 'Pause');
    const resetLabel = tr('common.reset', 'Reset');
    const inProgress = !isRunning && display.remainingSeconds < totalSeconds;

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
    const clock = formatPomodoroClock(display.remainingSeconds);
    const clockClass = 'fx-display text-[15px] font-normal leading-none tracking-tight tabular-nums';
    // Focus mode in the main window is minimised or hidden: offer the way back from here.
    const presentation = readStoredPresentation();
    const showBackToFocus = presentation !== null && presentation !== 'full'
        && (isRunning || display.remainingSeconds < totalSeconds);
    const backLabel = tr('focus.backToFocus', 'Back to focus');
    const backToFocus = () => {
        if (!isTauriRuntime()) return;
        void openMainFromMenuBarPanel()
            .then(() => notifyMainWindow(MENUBAR_FOCUS_EXPAND_EVENT))
            .catch((error) => reportError('Failed to show Focus mode', error));
    };
    const iconButtonClass = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-ring';

    return (
        <section
            ref={rootRef}
            aria-label={tr('pomodoro.title', 'Pomodoro Focus')}
            data-phase={display.phase}
            data-running={isRunning ? 'true' : 'false'}
            className="relative rounded-card bg-card px-2.5 py-2 shadow-soft-sm"
        >
            <div className="flex items-center gap-2.5">
                <PomodoroRing progress={progress} phase={display.phase} size={52} stroke={4} well={false} running={isRunning}>
                    {isRunning ? (
                        <span className={clockClass} data-testid="panel-pomodoro-clock">{clock}</span>
                    ) : (
                        <button
                            ref={clockRef}
                            type="button"
                            onClick={() => { setPickerOpen(false); setPresetsOpen((open) => !open); }}
                            aria-label={presetsLabel}
                            aria-haspopup="true"
                            aria-expanded={presetsOpen}
                            title={presetsLabel}
                            className="rounded-md px-1 py-1 transition-colors hover:bg-foreground/5 focus-ring"
                        >
                            <span className={clockClass} data-testid="panel-pomodoro-clock">{clock}</span>
                        </button>
                    )}
                </PomodoroRing>

                <div className="min-w-0 flex-1">
                    {!isFocus ? (
                        <p className="truncate text-[14px] font-medium text-success-text">{phase}</p>
                    ) : isRunning ? (
                        <>
                            <p className="truncate text-[14px] font-semibold" title={selectedTask?.title}>{selectedTask?.title ?? phase}</p>
                            {nowLine && (
                                <p className="truncate text-[12px] text-muted-foreground" title={nowLine} data-testid="panel-focus-step">
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
                            <span className={cn('truncate text-[14px]', selectedTask ? 'font-semibold' : 'text-muted-foreground')}>
                                {selectedTask?.title ?? tr('pomodoro.chooseTask', 'Choose a task')}
                            </span>
                        </button>
                    )}
                </div>

                {inProgress && (
                    <button type="button" onClick={reset} aria-label={resetLabel} title={resetLabel} className={cn(iconButtonClass, 'pomo-in')}>
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    </button>
                )}
                {showBackToFocus && (
                    <button type="button" onClick={backToFocus} aria-label={backLabel} title={backLabel} className={cn(iconButtonClass, 'pomo-in')} data-testid="panel-back-to-focus">
                        <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                )}
                {isRunning ? (
                    <button
                        key="pause"
                        type="button"
                        onClick={toggle}
                        aria-label={pauseLabel}
                        title={pauseLabel}
                        className={cn(iconButtonClass, 'pomo-in bg-well shadow-soft-inset')}
                    >
                        <Pause className="h-3.5 w-3.5" aria-hidden />
                    </button>
                ) : (
                    <button
                        key="start"
                        type="button"
                        onClick={toggle}
                        className="btn-gradient pomo-in inline-flex h-8 shrink-0 items-center gap-1.5 px-3.5 text-[13px] focus-ring"
                    >
                        <Play className="h-3.5 w-3.5" aria-hidden />
                        {tr('common.start', 'Start')}
                    </button>
                )}
            </div>

            <PomodoroPresetPopover
                open={presetsOpen && !isRunning}
                onClose={closePresets}
                anchorRef={clockRef}
                ariaLabel={presetsLabel}
                activeId={activePreset?.id}
                presets={presetOptions.map((preset) => ({ id: preset.id, name: presetNames[preset.id] ?? preset.label, value: preset.label }))}
                onPick={(id) => {
                    const preset = presetOptions.find((option) => option.id === id);
                    if (preset) applyPreset(preset.focusMinutes, preset.breakMinutes);
                }}
                className="bottom-full left-1 mb-1.5"
            />

            {pickerOpen && (
                <ul
                    role="listbox"
                    aria-label={pickerLabel}
                    className="pomo-pop absolute bottom-full left-0 right-0 z-20 mb-1.5 max-h-52 overflow-y-auto rounded-card bg-popover p-1 text-popover-foreground shadow-soft"
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
