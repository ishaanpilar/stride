import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { formatPomodoroClock, formatPomodoroOvertime } from '@stride/core';
import { Check, ChevronDown, ChevronUp, Maximize2, Pause, Play, X } from 'lucide-react';
import type { FocusFloatDisplay, FocusFloatState } from '../../lib/focus-float-window';
import { cn } from '../../lib/utils';
import { FocusTint } from '../focus/FocusVisuals';

export interface FocusFloatViewProps {
    state: FocusFloatState;
    display: FocusFloatDisplay;
    expanded: boolean;
    tr: (key: string, fallback: string) => string;
    onToggleRun: () => void;
    onOpen: () => void;
    onToggleExpanded: () => void;
    onClose: () => void;
    onStartNext: () => void;
    /** Mouse down on the surface (not a button): start moving the window. */
    onDragStart?: () => void;
}

/**
 * The floating timer's face: big thin time, the task, a hairline of progress, and four small
 * buttons. Expanded, it also shows the current and next step. Break is teal; a finished session
 * offers the way back to Stride.
 */
export function FocusFloatView(props: FocusFloatViewProps) {
    const { state, display, expanded, tr } = props;
    const [hovered, setHovered] = useState(false);
    const { view, isRunning } = display;
    const isBreak = view === 'break';
    const isDone = view === 'finish' || view === 'ready';
    const inOvertime = display.overtimeSeconds !== undefined;
    const clock = inOvertime ? formatPomodoroOvertime(display.overtimeSeconds ?? 0) : formatPomodoroClock(display.remainingSeconds);
    const runLabel = inOvertime && isRunning
        ? tr('focus.pauseCheckIn', 'Pause and check in')
        : isRunning ? tr('common.pause', 'Pause') : tr('focus.resume', 'Resume');
    const openLabel = tr('focus.openStride', 'Open Stride');
    const expandLabel = expanded ? tr('focus.compact', 'Show less') : tr('focus.expand', 'Show steps');
    const closeLabel = tr('focus.closeFloat', 'Close floating timer (timer keeps running)');
    const title = state.taskTitle ?? tr('pomodoro.timerOnly', 'Timer only');
    const status = view === 'finish'
        ? tr('focus.sessionComplete', 'Session complete')
        : view === 'ready'
            ? tr('focus.breakOver', 'Break over')
            : isBreak
                ? tr('pomodoro.phaseBreakShort', 'Break')
                : inOvertime
                    ? tr('focus.overtimeShort', 'Over time')
                    : !isRunning
                    ? tr('pomodoro.paused', 'Paused')
                    : null;
    // Compact shows the task; hovering (or keyboard focus) swaps in the current step.
    const showStepInline = !expanded && hovered && !isBreak && !isDone && Boolean(state.currentStep);

    const onMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
        props.onDragStart?.();
    };

    const iconButton = 'ff-btn focus-ring';

    return (
        <section
            aria-label={tr('focus.floatLabel', 'Floating focus timer')}
            data-testid="focus-float"
            data-view={view}
            data-phase={display.phase}
            data-paused={isRunning ? undefined : 'true'}
            data-overtime={inOvertime ? 'true' : undefined}
            data-expanded={expanded ? 'true' : undefined}
            className="ff-root"
            onMouseDown={onMouseDown}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovered(false); }}
        >
            <FocusTint kind={view === 'finish' ? 'finish' : isBreak ? 'break' : 'focus'} progress={display.progress} />
            <div className="ff-body">
                <div className="ff-row">
                    {isDone ? (
                        <span className="ff-done" data-testid="focus-float-status">
                            {view === 'finish' && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                            {status}
                        </span>
                    ) : (
                        <>
                            <span
                                className="ff-clock"
                                role="timer"
                                aria-label={inOvertime
                                    ? tr('focus.overtimeLabel', '{{time}} over time').replace('{{time}}', clock.slice(1))
                                    : tr('focus.timeLeft', '{{time}} remaining').replace('{{time}}', clock)}
                                data-testid="focus-float-clock"
                            >
                                {clock}
                            </span>
                            {status && (
                                <span className={cn('ff-status', isBreak && 'ff-status--break')} data-testid="focus-float-status">{status}</span>
                            )}
                        </>
                    )}
                    <div className="ml-auto flex items-center gap-0.5">
                        {view === 'ready' ? (
                            <button type="button" onClick={props.onStartNext} aria-label={tr('focus.startNext', 'Start next session')} title={tr('focus.startNext', 'Start next session')} className={iconButton} data-testid="focus-float-start-next">
                                <Play className="h-3.5 w-3.5" aria-hidden />
                            </button>
                        ) : view !== 'finish' && (
                            <button type="button" onClick={props.onToggleRun} aria-label={runLabel} title={runLabel} className={iconButton} data-testid="focus-float-toggle">
                                {isRunning ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                            </button>
                        )}
                        <button type="button" onClick={props.onOpen} aria-label={openLabel} title={openLabel} className={iconButton} data-testid="focus-float-open">
                            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        {!isDone && (
                            <button
                                type="button"
                                onClick={props.onToggleExpanded}
                                aria-label={expandLabel}
                                aria-expanded={expanded}
                                title={expandLabel}
                                className={iconButton}
                                data-testid="focus-float-expand"
                            >
                                {expanded ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
                            </button>
                        )}
                        <button type="button" onClick={props.onClose} aria-label={closeLabel} title={closeLabel} className={iconButton} data-testid="focus-float-close">
                            <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                    </div>
                </div>

                {view === 'finish' ? (
                    <button type="button" onClick={props.onOpen} className="ff-link focus-ring" data-testid="focus-float-open-stride">
                        {tr('focus.openStrideToCheckIn', 'Open Stride to check in')}
                    </button>
                ) : showStepInline ? (
                    <p className="ff-line" title={state.currentStep ?? undefined} data-testid="focus-float-line">
                        <span className="ff-muted">{tr('focus.panelStep', 'Now')}:</span> {state.currentStep}
                    </p>
                ) : (
                    <p className={cn('ff-line', !state.taskTitle && 'ff-muted')} title={title} data-testid="focus-float-line">{title}</p>
                )}

                {expanded && !isDone && (isBreak ? (
                    <p className="ff-steps ff-muted" data-testid="focus-float-steps">
                        {tr('focus.breakIdea.0', 'Stand up and stretch your shoulders.')}
                    </p>
                ) : (
                    <dl className="ff-steps" data-testid="focus-float-steps">
                        <div>
                            <dt className="ff-muted">{tr('focus.panelStep', 'Now')}</dt>
                            <dd title={state.currentStep ?? undefined}>{state.currentStep ?? tr('focus.noSteps', 'No steps yet')}</dd>
                        </div>
                        {state.nextStep && (
                            <div>
                                <dt className="ff-muted">{tr('focus.nextLabel', 'Next')}</dt>
                                <dd title={state.nextStep}>{state.nextStep}</dd>
                            </div>
                        )}
                    </dl>
                ))}
            </div>
            <div className="ff-progress" aria-hidden><i style={{ width: `${display.progress * 100}%` }} /></div>
            <div className="sr-only" role="status" aria-live="polite">{isDone ? status : ''}</div>
        </section>
    );
}
