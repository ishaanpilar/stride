import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { formatPomodoroClock, formatPomodoroOvertime, type ChecklistItem, type PomodoroPhase, type Task } from '@stride/core';
import { Maximize2, Pause, PictureInPicture2, Play, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAssistantDockStore } from '../../store/assistant-dock-store';
import { clampMiniPosition, type FocusMiniPosition } from '../../store/focus-session-store';
import { PomodoroRing } from '../views/PomodoroRing';
import { FocusTint } from './FocusVisuals';
import { PomodoroAdjust } from '../views/PomodoroAdjust';
import { focusAnchors, rectOf } from './focus-anchors';

const GAP = 16;

/** Width of the Assistant dock (or drawer) on the right edge, so floating UI never covers it. */
export function useAssistantDockInset(): number {
    const open = useAssistantDockStore((s) => s.open);
    const drawerOpen = useAssistantDockStore((s) => s.drawerOpen);
    const width = useAssistantDockStore((s) => s.width);
    const [inset, setInset] = useState(0);
    useEffect(() => {
        const measure = () => {
            const dock = document.querySelector('[data-assistant-dock]') ?? document.querySelector('[data-testid="assistant-drawer"] aside');
            setInset(dock ? Math.round(dock.getBoundingClientRect().width) : 0);
        };
        measure();
        const settle = window.setTimeout(measure, 320);
        window.addEventListener('resize', measure);
        return () => {
            window.clearTimeout(settle);
            window.removeEventListener('resize', measure);
        };
    }, [open, drawerOpen, width]);
    return inset;
}

interface FocusMiniProps {
    task?: Task;
    phase: PomodoroPhase;
    remainingSeconds: number;
    totalSeconds: number;
    /** Present while counting up past 0:00 ("Keep going"). */
    overtimeSeconds?: number;
    isRunning: boolean;
    steps: ChecklistItem[];
    position: FocusMiniPosition;
    /** Pop in a beat late, as the stage finishes shrinking into it. */
    delayed: boolean;
    /** Came from the stage: move keyboard focus here so it is not lost. */
    takeFocus: boolean;
    tr: (key: string, fallback: string) => string;
    onToggleRun: () => void;
    onExpand: () => void;
    onHide: () => void;
    onToggleStep: (id: string) => void;
    onMove: (position: FocusMiniPosition) => void;
    /** Pop the timer out into the floating window (over every app). Absent where unsupported. */
    onFloat?: () => void;
    /** "−" / "+" beside the time. */
    adjust: { canDecrease: boolean; canIncrease: boolean; onAdjust: (deltaMinutes: number) => number };
}

/** Minimised focus: a small floating card over the normal app. Drag it anywhere; it remembers. */
export function FocusMini(props: FocusMiniProps) {
    const { task, tr, steps, isRunning, phase } = props;
    const ref = useRef<HTMLElement>(null);
    const dock = useAssistantDockInset();
    const [drag, setDrag] = useState<{ x: number; y: number; start: FocusMiniPosition; now: FocusMiniPosition } | null>(null);
    const position = drag?.now ?? props.position;
    const right = position.right + dock;
    const isBreak = phase === 'break';
    const done = steps.filter((s) => s.isCompleted).length;
    const current = steps.find((s) => !s.isCompleted);
    const inOvertime = props.overtimeSeconds !== undefined && !isBreak;
    const progress = inOvertime
        ? Math.min(1, (props.overtimeSeconds ?? 0) / Math.max(1, props.totalSeconds))
        : props.totalSeconds > 0 ? Math.min(1, Math.max(0, 1 - props.remainingSeconds / props.totalSeconds)) : 0;
    const clock = inOvertime ? formatPomodoroOvertime(props.overtimeSeconds ?? 0) : formatPomodoroClock(props.remainingSeconds);
    const runLabel = inOvertime && isRunning
        ? tr('focus.pauseCheckIn', 'Pause and check in')
        : isRunning ? tr('common.pause', 'Pause') : tr('common.start', 'Start');
    const expandLabel = tr('focus.backToFocus', 'Back to focus');
    const hideLabel = tr('focus.hide', 'Hide, keep timer running');
    const floatLabel = tr('focus.float', 'Float timer over other apps');

    useLayoutEffect(() => { focusAnchors.mini = rectOf(ref.current); });
    useEffect(() => {
        if (props.takeFocus) ref.current?.querySelector<HTMLElement>('[data-testid="focus-mini-expand"]')?.focus({ preventScroll: true });
    }, []);

    // Keep it on screen when the window shrinks.
    useEffect(() => {
        const onResize = () => {
            const size = ref.current?.getBoundingClientRect();
            const next = clampMiniPosition(props.position, { width: window.innerWidth - dock, height: window.innerHeight }, size ? { width: size.width, height: size.height } : undefined);
            if (next.right !== props.position.right || next.bottom !== props.position.bottom) props.onMove(next);
        };
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [dock, props.position.right, props.position.bottom]);

    const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button, input')) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDrag({ x: event.clientX, y: event.clientY, start: props.position, now: props.position });
    };
    const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
        if (!drag) return;
        const size = ref.current?.getBoundingClientRect();
        const now = clampMiniPosition(
            { right: drag.start.right - (event.clientX - drag.x), bottom: drag.start.bottom - (event.clientY - drag.y) },
            { width: window.innerWidth - dock, height: window.innerHeight },
            size ? { width: size.width, height: size.height } : undefined,
        );
        setDrag({ ...drag, now });
    };
    const endDrag = () => {
        if (!drag) return;
        props.onMove(drag.now);
        setDrag(null);
    };

    const iconButton = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-well focus-ring';

    return (
        <section
            ref={ref}
            aria-label={tr('focus.stageLabel', 'Focus session')}
            data-focus-mini
            data-testid="focus-mini"
            data-phase={phase}
            data-paused={isRunning ? undefined : 'true'}
            data-overtime={inOvertime ? 'true' : undefined}
            data-dragging={drag ? 'true' : undefined}
            className={cn('fx-mini cursor-grab touch-none select-none', props.delayed ? 'fx-pop-in [animation-delay:240ms]' : 'fx-pop-in')}
            style={{ right, bottom: position.bottom }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
        >
            <FocusTint kind={isBreak ? 'break' : 'focus'} progress={progress} />
            <div className="relative px-4 pb-3.5 pt-3">
                <div className="flex items-center gap-2">
                    <span
                        className={cn('fx-mini-clock', inOvertime && 'text-muted-foreground')}
                        role="timer"
                        aria-label={inOvertime
                            ? tr('focus.overtimeLabel', '{{time}} over time').replace('{{time}}', clock.slice(1))
                            : tr('focus.timeLeft', '{{time}} remaining').replace('{{time}}', clock)}
                    >
                        {clock}
                    </span>
                    <PomodoroAdjust
                        size="sm"
                        tr={tr}
                        canDecrease={props.adjust.canDecrease}
                        canIncrease={props.adjust.canIncrease}
                        onAdjust={props.adjust.onAdjust}
                        testId="focus-mini-adjust"
                    />
                    {(isBreak || !isRunning || inOvertime) && (
                        <span className={cn('text-[13px] font-medium', isBreak ? 'text-success-text' : 'text-muted-foreground')}>
                            {isBreak ? tr('pomodoro.phaseBreakShort', 'Break') : inOvertime ? tr('focus.overtimeShort', 'Over time') : tr('pomodoro.paused', 'Paused')}
                        </span>
                    )}
                    <div className="ml-auto flex items-center gap-0.5">
                        <button type="button" onClick={props.onToggleRun} aria-label={runLabel} title={runLabel} className={iconButton}>
                            {isRunning ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                        </button>
                        {props.onFloat && (
                            <button type="button" onClick={props.onFloat} aria-label={floatLabel} title={floatLabel} className={iconButton} data-testid="focus-mini-float">
                                <PictureInPicture2 className="h-4 w-4" aria-hidden />
                            </button>
                        )}
                        <button type="button" onClick={props.onExpand} aria-label={expandLabel} title={expandLabel} className={iconButton} data-testid="focus-mini-expand">
                            <Maximize2 className="h-4 w-4" aria-hidden />
                        </button>
                        <button type="button" onClick={props.onHide} aria-label={hideLabel} title={hideLabel} className={iconButton}>
                            <X className="h-4 w-4" aria-hidden />
                        </button>
                    </div>
                </div>
                <p className={cn('mt-2 truncate text-[14px]', task ? 'font-semibold' : 'font-medium text-muted-foreground')} title={task?.title}>
                    {task?.title ?? tr('pomodoro.timerOnly', 'Timer only')}
                </p>
                {!isBreak && current && (
                    <div className="mt-1.5 flex items-center gap-2.5 text-[14px]">
                        <button
                            type="button"
                            role="checkbox"
                            aria-checked={false}
                            aria-label={current.title}
                            onClick={() => props.onToggleStep(current.id)}
                            className="inline-flex h-5 w-5 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_hsl(var(--accent-text))] transition-colors hover:bg-accent-soft focus-ring"
                        />
                        <span className="min-w-0 flex-1 truncate text-foreground">{current.title}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{done + 1}/{steps.length}</span>
                    </div>
                )}
            </div>
            <div className="fx-hair" aria-hidden><i style={{ width: `${progress * 100}%`, opacity: inOvertime ? 0.45 : undefined }} /></div>
        </section>
    );
}

interface FocusPillProps {
    takeFocus: boolean;
    phase: PomodoroPhase;
    remainingSeconds: number;
    totalSeconds: number;
    /** Present while counting up past 0:00 ("Keep going"). */
    overtimeSeconds?: number;
    isRunning: boolean;
    tr: (key: string, fallback: string) => string;
    onExpand: () => void;
}

/** Hidden focus: just the time in a corner. The timer keeps running; one click goes back. */
export function FocusPill({ takeFocus, phase, remainingSeconds, totalSeconds, overtimeSeconds, isRunning, tr, onExpand }: FocusPillProps) {
    const ref = useRef<HTMLButtonElement>(null);
    const dock = useAssistantDockInset();
    const inOvertime = overtimeSeconds !== undefined && phase === 'focus';
    const clock = inOvertime ? formatPomodoroOvertime(overtimeSeconds) : formatPomodoroClock(remainingSeconds);
    const progress = totalSeconds > 0 ? Math.min(1, Math.max(0, 1 - remainingSeconds / totalSeconds)) : 0;
    const label = `${tr('focus.backToFocus', 'Back to focus')}, ${clock}`;
    useLayoutEffect(() => { focusAnchors.pill = rectOf(ref.current); });
    useEffect(() => { if (takeFocus) ref.current?.focus({ preventScroll: true }); }, []);
    return (
        <button
            ref={ref}
            type="button"
            onClick={onExpand}
            aria-label={label}
            title={tr('focus.backToFocus', 'Back to focus')}
            data-focus-pill
            data-testid="focus-pill"
            className="fx-pill fx-pop-in [animation-delay:200ms] focus-ring"
            style={{ right: GAP + 4 + dock, bottom: GAP + 4 }}
        >
            <PomodoroRing
                progress={progress}
                phase={phase}
                size={24}
                stroke={3}
                well={false}
                running={isRunning}
                overtime={inOvertime ? Math.min(1, (overtimeSeconds ?? 0) / Math.max(1, totalSeconds)) : undefined}
            />
            <span className={cn((!isRunning || inOvertime) && 'text-muted-foreground')} data-overtime={inOvertime ? 'true' : undefined}>{clock}</span>
        </button>
    );
}
