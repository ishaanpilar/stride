import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { formatPomodoroClock, formatPomodoroOvertime, type ChecklistItem, type FocusCoachAction, type FocusCoachReply, type PomodoroPhase, type Project, type Task } from '@stride/core';
import { ArrowRight, Maximize, Minimize, Minimize2, Pause, Play, Square, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { canAnimate } from '../../lib/motion';
import type { FocusOrigin } from '../../store/focus-session-store';
import { PomodoroTaskPicker } from '../views/PomodoroTaskPicker';
import type { FocusUndo } from '../../lib/focus-coach-store';
import { FocusCheckIn } from './FocusCheckIn';
import { FocusCoachCard } from './FocusCoachCard';
import { FocusFinish, type FinishKind, type FocusSummary } from './FocusFinish';
import { FocusSteps } from './FocusSteps';
import { FocusAmbient, FocusClock } from './FocusVisuals';
import { focusAnchors, rectOf, transformBetween } from './focus-anchors';
import type { FocusCoachApi } from './useFocusCoach';

export type FocusView = 'focus' | 'break' | 'ready' | 'finish';
export type StageEnter = 'origin' | 'mini' | 'hidden' | 'none';

export interface FocusStageProps {
    view: FocusView;
    finishKind: FinishKind;
    phase: PomodoroPhase;
    /** Undefined for a plain timer: the card offers to attach a task instead. */
    task?: Task;
    project?: Project;
    remainingSeconds: number;
    totalSeconds: number;
    /** Present while counting up past 0:00 ("Keep going"). */
    overtimeSeconds?: number;
    isRunning: boolean;
    /** The session still has a live phase (so it can be minimised or hidden instead of closed). */
    active: boolean;
    confirmingEnd: boolean;
    steps: ChecklistItem[];
    coach: FocusCoachApi;
    focusMinutes: number;
    note: string | null;
    sentence: string;
    breakIdea: string;
    announcement: string;
    summary: FocusSummary;
    pulseKey: number;
    enter: StageEnter;
    origin: FocusOrigin | null;
    /** Set while the stage animates away into the mini card or the pill. */
    exiting: 'mini' | 'hidden' | null;
    onExited: () => void;
    tr: (key: string, fallback: string) => string;
    onToggleRun: () => void;
    onEnd: () => void;
    onConfirmEnd: () => void;
    onCancelEnd: () => void;
    onMinimise: () => void;
    onHide: () => void;
    onSkipBreak: () => void;
    onStartNext: () => void;
    onToggleStep: (id: string) => void;
    onRenameStep: (id: string, title: string) => void;
    onRemoveStep: (id: string) => void;
    onAddStep: (title: string) => void;
    onMarkDone: () => Promise<FocusUndo | null>;
    onApplyAction: (action: FocusCoachAction) => Promise<FocusUndo | null>;
    onAskCoach: (text: string) => Promise<FocusCoachReply>;
    onCheckInBreak: (afterDone: boolean) => void;
    onCloseSession: () => void;
    /** Check-in "Almost": keep working on this task for that many more minutes. */
    onExtend: (minutes: number) => void;
    onTakeBreak: () => void;
    onKeepGoing: () => void;
    pickerTasks: Task[];
    onPickTask: (taskId: string | undefined) => void;
    /** The window is in true (macOS) full screen. */
    fullscreen: boolean;
    onToggleFullscreen: () => void;
}

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
/** A settle with a small overshoot: premium, not bouncy. */
const SPRING = 'cubic-bezier(0.34, 1.32, 0.64, 1)';
const IDLE_MS = 3000;

export function FocusStage(props: FocusStageProps) {
    const { view, phase, task, project, tr, steps, isRunning, exiting } = props;
    const rootRef = useRef<HTMLDivElement>(null);
    const columnRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const bloomRef = useRef<HTMLDivElement>(null);
    const [lit, setLit] = useState(false);
    const [idle, setIdle] = useState(false);
    const [intro, setIntro] = useState(true);
    const done = steps.filter((s) => s.isCompleted).length;
    const total = steps.length;
    const inOvertime = props.overtimeSeconds !== undefined && view === 'focus';
    const progress = inOvertime
        ? Math.min(1, (props.overtimeSeconds ?? 0) / Math.max(1, props.totalSeconds))
        : props.totalSeconds > 0 ? Math.min(1, Math.max(0, 1 - props.remainingSeconds / props.totalSeconds)) : 0;
    const isBreak = view === 'break';
    const paused = !isRunning && (view === 'focus' || view === 'break');
    const clock = inOvertime ? formatPomodoroOvertime(props.overtimeSeconds ?? 0) : formatPomodoroClock(props.remainingSeconds);

    // Enter: light up, and grow the card out of where the session came from.
    useLayoutEffect(() => {
        const start = window.requestAnimationFrame(() => setLit(true));
        const subTimer = window.setTimeout(() => setIntro(false), 3600);
        const column = columnRef.current;
        if (!canAnimate() || !column) return () => { window.cancelAnimationFrame(start); window.clearTimeout(subTimer); };
        const columnRect = rectOf(column);
        const anchor = props.enter === 'mini' ? focusAnchors.mini : props.enter === 'hidden' ? focusAnchors.pill : null;
        if (anchor && columnRect) {
            // Grow back out of the mini card / pill.
            column.animate(
                [{ transform: transformBetween(columnRect, anchor), opacity: 0, filter: 'blur(8px)' }, { transform: 'none', opacity: 1, filter: 'blur(0)' }],
                { duration: 450, easing: SPRING },
            );
        } else {
            // The card grows out of the row / card that started it (or rises into place), with blur.
            const card = cardRef.current ?? column.querySelector<HTMLElement>('.fx-finish');
            const cardRect = rectOf(card);
            const from = props.enter === 'origin' ? props.origin : null;
            if (card && cardRect) {
                const start = from ? transformBetween(cardRect, from) : 'translateY(40px) scale(0.88)';
                card.animate([
                    { transform: start, opacity: 0, filter: 'blur(14px)' },
                    { opacity: 1, offset: 0.4 },
                    { transform: 'none', opacity: 1, filter: 'blur(0)' },
                ], { duration: 600, easing: SPRING });
            }
            const bloom = bloomRef.current;
            if (bloom) {
                const cx = from ? from.x + from.width / 2 : window.innerWidth / 2;
                const cy = from ? from.y + from.height / 2 : window.innerHeight / 2;
                bloom.style.left = `${cx}px`;
                bloom.style.top = `${cy}px`;
                bloom.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(70)' }], { duration: 1200, easing: EASE });
            }
            column.querySelectorAll('.fx-note, .fx-controls').forEach((el) => {
                el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 380, fill: 'backwards', easing: SPRING });
            });
        }
        return () => { window.cancelAnimationFrame(start); window.clearTimeout(subTimer); };
    }, []);

    // Exit: shrink the column into the mini card / pill while the light fades.
    useLayoutEffect(() => {
        if (!exiting) return;
        const column = columnRef.current;
        const root = rootRef.current;
        if (!canAnimate() || !column || !root) { props.onExited(); return; }
        const target = rectOf(document.querySelector(exiting === 'mini' ? '[data-focus-mini]' : '[data-focus-pill]'));
        const from = rectOf(column);
        const frames = target && from
            ? [{ transform: 'none', opacity: 1, filter: 'blur(0)' }, { opacity: 0.9, offset: 0.6 }, { transform: transformBetween(from, target), opacity: 0, filter: 'blur(6px)' }]
            : [{ transform: 'none', opacity: 1 }, { transform: 'scale(0.92)', opacity: 0, filter: 'blur(6px)' }];
        const shrink = column.animate(frames, { duration: 450, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'forwards' });
        root.querySelectorAll('.fx-veil, .fx-amb, .fx-top').forEach((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, fill: 'forwards', easing: 'ease-out' }));
        shrink.finished.then(() => props.onExited(), () => props.onExited());
    }, [exiting]);

    // Focus the main control when the view changes (the app behind is inert).
    useEffect(() => {
        if (exiting) return;
        const node = rootRef.current;
        if (!node) return;
        if (node.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') return;
        (node.querySelector<HTMLElement>('[data-autofocus]') ?? node).focus({ preventScroll: true });
    }, [view, props.confirmingEnd]);

    // Controls fade after a few seconds without the pointer while a focus phase runs.
    useEffect(() => {
        const canIdle = isRunning && view === 'focus' && !props.confirmingEnd;
        if (!canIdle) { setIdle(false); return; }
        let timer = window.setTimeout(() => setIdle(true), IDLE_MS);
        const wake = () => {
            setIdle(false);
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setIdle(true), IDLE_MS);
        };
        window.addEventListener('pointermove', wake);
        window.addEventListener('keydown', wake);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('pointermove', wake);
            window.removeEventListener('keydown', wake);
        };
    }, [isRunning, view, props.confirmingEnd]);

    // Keep Tab inside the stage; Space pauses and resumes when nothing else wants it.
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        if (event.key === ' ' && (target === rootRef.current || target.classList.contains('fx-center')) && (view === 'focus' || view === 'break')) {
            event.preventDefault();
            props.onToggleRun();
            return;
        }
        if (event.key !== 'Tab') return;
        const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []);
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };

    const runLabel = inOvertime && isRunning
        ? tr('focus.pauseCheckIn', 'Pause and check in')
        : isRunning ? tr('common.pause', 'Pause') : tr('common.start', 'Start');
    const runButton = (
        <button
            type="button"
            data-autofocus
            onClick={props.onToggleRun}
            aria-label={runLabel}
            title={`${runLabel} (Space)`}
            className="fx-round fx-round--main focus-ring"
        >
            {isRunning ? <Pause className="h-5 w-5" aria-hidden /> : <Play className="h-5 w-5" aria-hidden />}
        </button>
    );

    let sub = '';
    if (view === 'ready') sub = tr('focus.readyBody', 'Ready for another round when you are.');
    else if (inOvertime) sub = tr('focus.overtimeSub', 'Over time. Keep going, or pause to check in.');
    else if (paused) sub = tr('pomodoro.paused', 'Paused');
    else if (isBreak) sub = tr('pomodoro.phaseBreakShort', 'Break');
    else if (intro) sub = tr('focus.oneThing', 'One thing at a time.');

    const currentStep = steps.find((s) => !s.isCompleted);
    let controls: ReactNode;
    if (props.confirmingEnd) {
        controls = (
            <div className="flex flex-wrap items-center justify-center gap-2.5" role="group" aria-label={tr('focus.leaveTitle', 'Leave focus?')}>
                <span className="w-full text-center text-[15px] font-medium sm:w-auto sm:pr-2">{tr('focus.leaveTitle', 'Leave focus?')}</span>
                <button type="button" data-autofocus onClick={props.onCancelEnd} className="btn-gradient inline-flex h-10 items-center px-4 text-[14px] focus-ring">
                    {tr('focus.stay', 'Stay focused')}
                </button>
                <button type="button" onClick={props.onConfirmEnd} className="inline-flex h-10 items-center rounded-control border border-border bg-card px-4 text-[14px] font-medium text-foreground shadow-soft-sm hover:bg-accent focus-ring">
                    {tr('focus.endSession', 'End session')}
                </button>
            </div>
        );
    } else if (view === 'ready') {
        controls = (
            <button type="button" data-autofocus onClick={props.onStartNext} className="btn-gradient inline-flex h-11 items-center gap-2 px-5 text-[14px] focus-ring">
                <Play className="h-4 w-4" aria-hidden />{tr('focus.anotherSession', 'Another session')}
            </button>
        );
    } else if (isBreak) {
        controls = (
            <>
                {runButton}
                <button type="button" onClick={props.onSkipBreak} aria-label={tr('focus.skipBreak', 'Skip break')} title={tr('focus.skipBreak', 'Skip break')} className="fx-round fx-round--sm focus-ring">
                    <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
            </>
        );
    } else {
        const endLabel = tr('focus.endSession', 'End session');
        controls = (
            <>
                <button type="button" onClick={props.onEnd} aria-label={endLabel} title={endLabel} className="fx-round fx-round--sm focus-ring">
                    <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
                </button>
                {runButton}
            </>
        );
    }

    const hideLabel = props.active ? tr('focus.hide', 'Hide, keep timer running') : tr('common.close', 'Close');
    const minimiseLabel = tr('focus.minimise', 'Minimise');
    const fullscreenLabel = props.fullscreen ? tr('focus.exitFullScreen', 'Exit full screen') : tr('focus.enterFullScreen', 'Enter full screen');
    const kind = view === 'finish' ? 'finish' : isBreak ? 'break' : 'focus';
    const countLabel = tr('focus.stepProgress', 'Step {{current}} of {{total}}')
        .replace('{{current}}', String(Math.min(total, done + 1))).replace('{{total}}', String(total));

    return (
        <div
            ref={rootRef}
            role="dialog"
            aria-modal="true"
            aria-label={tr('focus.stageLabel', 'Focus session')}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            data-focus-stage
            data-testid="focus-overlay"
            data-lit={lit ? 'true' : 'false'}
            data-paused={paused ? 'true' : undefined}
            data-idle={idle ? 'true' : undefined}
            data-view={view}
            data-overtime={inOvertime ? 'true' : undefined}
            aria-hidden={exiting ? true : undefined}
            inert={exiting ? true : undefined}
            className="fx-stage fixed inset-0 focus:outline-none"
        >
            <div className="fx-veil" aria-hidden />
            <FocusAmbient kind={kind} progress={progress} paused={paused} pulseKey={props.pulseKey} />
            <div ref={bloomRef} className="fx-bloom" aria-hidden />
            {view === 'finish' && <div className="fx-wave" aria-hidden />}
            <div className="fx-drag" data-tauri-drag-region aria-hidden />

            <div className="fx-top fx-fade">
                <button
                    type="button"
                    onClick={props.onToggleFullscreen}
                    aria-label={fullscreenLabel}
                    aria-pressed={props.fullscreen}
                    title={props.fullscreen ? `${fullscreenLabel} (Esc)` : fullscreenLabel}
                    className="fx-round fx-round--xs focus-ring"
                    data-testid="focus-fullscreen"
                >
                    {props.fullscreen ? <Minimize className="h-3.5 w-3.5" aria-hidden /> : <Maximize className="h-3.5 w-3.5" aria-hidden />}
                </button>
                {props.active && (
                    <button type="button" onClick={props.onMinimise} aria-label={minimiseLabel} title={`${minimiseLabel} (Esc)`} className="fx-round fx-round--xs focus-ring" data-testid="focus-minimise">
                        <Minimize2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                )}
                <button type="button" onClick={props.onHide} aria-label={hideLabel} title={hideLabel} className="fx-round fx-round--xs focus-ring" data-testid="focus-hide">
                    <X className="h-4 w-4" aria-hidden />
                </button>
            </div>

            <div className="fx-center">
                <div ref={columnRef} className="fx-column">
                    {view !== 'finish' && (
                        <div className="fx-top-area">
                            <FocusClock
                                value={clock}
                                overtime={inOvertime}
                                intro={props.enter === 'origin' || props.enter === 'none'}
                                label={inOvertime
                                    ? tr('focus.overtimeLabel', '{{time}} over time').replace('{{time}}', clock.slice(1))
                                    : tr('focus.timeLeft', '{{time}} remaining').replace('{{time}}', clock)}
                            />
                            <p className="fx-sub" data-show={sub ? 'true' : 'false'} data-testid="focus-sub">{sub}</p>
                        </div>
                    )}

                    {view === 'finish' && task ? (
                        <FocusCheckIn
                            task={task}
                            project={project}
                            summary={props.summary}
                            sentence={props.sentence}
                            focusMinutes={props.focusMinutes}
                            tr={tr}
                            onDone={props.onMarkDone}
                            onApply={props.onApplyAction}
                            onAskCoach={props.onAskCoach}
                            onStartAnother={props.onKeepGoing}
                            onTakeBreak={props.onCheckInBreak}
                            onClose={props.onCloseSession}
                            onExtend={props.onExtend}
                        />
                    ) : view === 'finish' ? (
                        <FocusFinish
                            kind={props.finishKind}
                            task={task}
                            project={project}
                            sentence={props.sentence}
                            summary={props.summary}
                            tr={tr}
                            onMarkDone={() => { void props.onMarkDone(); }}
                            onTakeBreak={props.onTakeBreak}
                            onKeepGoing={props.onKeepGoing}
                        />
                    ) : (
                        <div ref={cardRef} className="fx-card" data-phase={phase} data-testid={isBreak ? 'focus-break' : 'focus-card'}>
                            {(project || (total > 0 && !isBreak)) && (
                                <div className="fx-head">
                                    {project && <span className="fx-dot" style={{ backgroundColor: project.color || 'hsl(var(--accent))' }} aria-hidden />}
                                    {project && <span className="truncate">{project.title}</span>}
                                    {total > 0 && !isBreak && <span className="fx-count" data-testid="focus-count">{countLabel}</span>}
                                </div>
                            )}
                            {task ? (
                                <h1 className={cn('fx-title', !project && !(total > 0 && !isBreak) && 'mt-0')}>
                                    {isBreak && currentStep
                                        ? tr('focus.upNext', 'Up next: {{step}}').replace('{{step}}', currentStep.title)
                                        : task.title}
                                </h1>
                            ) : (
                                <h1 className="fx-title fx-title--quiet mt-0" data-testid="focus-timer-only">
                                    {isBreak ? props.breakIdea : tr('pomodoro.timerOnly', 'Timer only')}
                                </h1>
                            )}
                            {!task ? (
                                !isBreak && (
                                    <div className="mt-3">
                                        <PomodoroTaskPicker
                                            className="-ml-1 w-fit max-w-full"
                                            tasks={props.pickerTasks}
                                            selectedTaskId={undefined}
                                            onSelect={props.onPickTask}
                                            label={tr('pomodoro.selectedTask', 'Timer task')}
                                            placeholder={tr('pomodoro.chooseTask', 'Choose a task')}
                                            timerOnlyLabel={tr('pomodoro.timerOnly', 'Timer only')}
                                            noTaskLabel={tr('pomodoro.noTask', 'No available focus task')}
                                            searchPlaceholder={tr('common.search', 'Search')}
                                            noMatchesLabel={tr('common.noMatches', 'No matches')}
                                            triggerClassName="mx-0 bg-accent-soft text-accent-text hover:bg-accent-soft [&>span]:text-accent-text [&>span]:font-medium [&>svg]:text-accent-text [&>svg]:opacity-100"
                                        />
                                    </div>
                                )
                            ) : isBreak ? (
                                <p className="fx-break-idea">{props.breakIdea}</p>
                            ) : (
                                <>
                                    <FocusCoachCard api={props.coach} tr={tr} />
                                    <FocusSteps
                                        steps={steps} tr={tr}
                                        onToggle={props.onToggleStep} onRename={props.onRenameStep} onRemove={props.onRemoveStep}
                                        onAdd={props.onAddStep}
                                    />
                                </>
                            )}
                            <div className="fx-hair" aria-hidden><i style={{ width: `${(view === 'ready' ? 0 : progress) * 100}%` }} /></div>
                        </div>
                    )}

                    {view !== 'finish' && (
                        <>
                            <p className="fx-note" data-show={props.note ? 'true' : 'false'} data-testid="focus-note">{props.note}</p>
                            <div className={cn('fx-controls', !props.confirmingEnd && 'fx-fade')}>{controls}</div>
                        </>
                    )}
                </div>
            </div>
            <div className="sr-only" role="status" aria-live="polite" data-testid="focus-live">{props.announcement}</div>
        </div>
    );
}
