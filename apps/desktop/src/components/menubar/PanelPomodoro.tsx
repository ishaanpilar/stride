import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatPomodoroClock, useTaskStore, type PomodoroAutoStartOptions, type Task } from '@stride/core';
import { Check, ChevronDown, Pause, Play, RotateCcw } from 'lucide-react';
import { MENUBAR_PANEL_SHOWN_EVENT, MENUBAR_POMODORO_CHANGED_EVENT, notifyMainWindow } from '../../lib/menubar-panel-window';
import { reportError } from '../../lib/report-error';
import { isTauriRuntime } from '../../lib/runtime';
import { cn } from '../../lib/utils';
import { reconcilePomodoroSnapshot, usePomodoroStore } from '../../store/pomodoro-store';

interface PanelPomodoroProps {
    candidates: Task[];
    tr: (key: string, fallback: string) => string;
}

const RING_RADIUS = 11;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function PanelPomodoro({ candidates, tr }: PanelPomodoroProps) {
    const autoStartBreaks = useTaskStore((state) => state.settings.gtd?.pomodoro?.autoStartBreaks === true);
    const autoStartFocus = useTaskStore((state) => state.settings.gtd?.pomodoro?.autoStartFocus === true);
    const snapshot = usePomodoroStore((state) => state.snapshot);
    const hydrate = usePomodoroStore((state) => state.hydratePomodoro);
    const commit = usePomodoroStore((state) => state.commitPomodoro);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [pickerOpen, setPickerOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
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

    const toggle = () => apply((prev) => {
        const reconciled = reconcilePomodoroSnapshot(prev, Date.now(), autoStart);
        return {
            ...reconciled,
            timerState: { ...reconciled.timerState, isRunning: !reconciled.timerState.isRunning },
            updatedAtMs: Date.now(),
        };
    });

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

    const selectTask = (taskId: string) => {
        apply((prev) => ({ ...prev, selectedTaskId: taskId || undefined }));
        setPickerOpen(false);
    };

    const selectedId = snapshot.selectedTaskId ?? '';
    const options = candidates.some((task) => task.id === selectedId) || !selectedId
        ? candidates
        : [...candidates, ...useTaskStore.getState()._allTasks.filter((task) => task.id === selectedId)];
    const selectedTask = options.find((task) => task.id === selectedId);
    const timerOnly = tr('pomodoro.timerOnly', 'Timer only');
    const pickerLabel = tr('pomodoro.selectedTask', 'Timer task');

    return (
        <section
            ref={rootRef}
            aria-label={tr('pomodoro.title', 'Pomodoro Focus')}
            className="relative flex items-center gap-2.5 rounded-xl bg-foreground/[0.05] px-2.5 py-2"
        >
            <div className="relative h-7 w-7 shrink-0" aria-hidden>
                <svg viewBox="0 0 28 28" className="h-7 w-7 -rotate-90">
                    <circle cx="14" cy="14" r={RING_RADIUS} fill="none" strokeWidth="2.5" className="stroke-foreground/10" />
                    <circle
                        cx="14" cy="14" r={RING_RADIUS} fill="none" strokeWidth="2.5" strokeLinecap="round"
                        className={cn('transition-[stroke-dashoffset] duration-700 ease-linear motion-reduce:transition-none', isFocus ? 'stroke-primary' : 'stroke-success')}
                        strokeDasharray={RING_CIRCUMFERENCE}
                        strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
                    />
                </svg>
            </div>
            <div className="leading-tight">
                <div className="font-mono text-[15px] font-semibold tabular-nums">{formatPomodoroClock(display.remainingSeconds)}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{phase}</div>
            </div>

            <button
                type="button"
                aria-label={pickerLabel}
                aria-haspopup="listbox"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((open) => !open)}
                className="ml-auto flex min-w-0 max-w-[132px] flex-1 items-center gap-1 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
                <span className="min-w-0 flex-1 truncate">{selectedTask?.title ?? timerOnly}</span>
                <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', pickerOpen && 'rotate-180')} aria-hidden />
            </button>

            <button
                type="button"
                onClick={reset}
                aria-label={tr('common.reset', 'Reset')}
                title={tr('common.reset', 'Reset')}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
                type="button"
                onClick={toggle}
                aria-label={isRunning ? tr('common.pause', 'Pause') : tr('common.start', 'Start')}
                title={isRunning ? tr('common.pause', 'Pause') : tr('common.start', 'Start')}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform hover:opacity-90 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
                {isRunning ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5 translate-x-px" aria-hidden />}
            </button>

            {pickerOpen && (
                <ul
                    role="listbox"
                    aria-label={pickerLabel}
                    className="absolute bottom-full left-0 right-0 z-20 mb-1.5 max-h-52 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
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
                                    <Check className={cn('h-3 w-3 shrink-0 text-primary', !selected && 'opacity-0')} aria-hidden />
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
