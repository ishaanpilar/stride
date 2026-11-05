import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    formatPomodoroClock,
    getFallbackEncouragement,
    getFocusMilestone,
    getPomodoroFocusSessionsCompletedToday,
    getPomodoroOvertimeSeconds,
    isPomodoroInOvertime,
    getPomodoroPhaseTotalSeconds,
    buildFocusCoachInput,
    isTaskActionable,
    resetPomodoroState,
    translateWithFallback,
    useTaskStore,
    type FocusCoachAction,
    type FocusCoachReply,
    type FocusMilestone,
    type PomodoroAutoStartOptions,
} from '@stride/core';
import { useLanguage } from '../../contexts/language-context';
import { canAnimate } from '../../lib/motion';
import { isWindowFullscreen, setWindowFullscreen } from '../../lib/window-fullscreen';
import { requestFocusCoachReply, requestFocusEncouragement } from '../../lib/focus-ai-service';
import { applyFocusCoachAction, markFocusTaskDone, readFocusCoachFeedbackSummary, writeFocusNow, type FocusUndo } from '../../lib/focus-coach-store';
import { getFocusStreak, recordFocusDay } from '../../lib/focus-streak';
import { useUiStore } from '../../store/ui-store';
import { reconcilePomodoroSnapshot, togglePomodoroSnapshot, usePomodoroStore } from '../../store/pomodoro-store';
import { useFocusSessionStore } from '../../store/focus-session-store';
import { useFocusFloatStore } from '../../store/focus-float-store';
import type { FocusFloatState } from '../../lib/focus-float-window';
import { FocusStage, type FocusView, type StageEnter } from './FocusStage';
import { FocusMini, FocusPill } from './FocusMini';
import { useFocusCoach } from './useFocusCoach';
import { useFocusSteps } from './useFocusSteps';
import { isFocusFloatSupported, useFocusFloatBridge } from './useFocusFloatBridge';
import { beginCompletion, cancelCompletion } from '../../lib/completion-sequence';

const NOTE_MS = 3200;
const BREAK_IDEAS = 4;

/**
 * Mounts once (inside the app shell, portalled to body so it is never dimmed). Owns the focus
 * session: auto-opens when a focus timer with a task is running, and shows it as the full stage,
 * the floating mini card or the background pill. The timer state lives in the pomodoro store.
 *
 * Keys: Esc minimises a live session (or closes a finished one); Space pauses on the stage.
 */
export function FocusSessionHost() {
    const { t, language } = useLanguage();
    const tr = useCallback((key: string, fallback: string) => translateWithFallback(t, key, fallback), [t]);
    const session = useFocusSessionStore();
    const snapshot = usePomodoroStore((s) => s.snapshot);
    const commit = usePomodoroStore((s) => s.commitPomodoro);
    const autoStartBreaks = useTaskStore((s) => s.settings.gtd?.pomodoro?.autoStartBreaks === true);
    const autoStartFocus = useTaskStore((s) => s.settings.gtd?.pomodoro?.autoStartFocus === true);
    const projects = useTaskStore((s) => s.projects);
    const liveTasks = useTaskStore((s) => s.tasks);
    const autoStart = useMemo<PomodoroAutoStartOptions>(() => ({ autoStartBreaks, autoStartFocus }), [autoStartBreaks, autoStartFocus]);

    const { timerState, durations, selectedTaskId, lastEvent } = snapshot;
    const taskId = session.open ? selectedTaskId : undefined;
    const stepsApi = useFocusSteps(taskId);
    const { task, steps } = stepsApi;
    const coachApi = useFocusCoach(task?.id, session.open, language, tr);
    const done = steps.filter((s) => s.isCompleted).length;
    const total = steps.length;

    const [note, setNote] = useState<{ key: string; text: string } | null>(null);
    const [sentence, setSentence] = useState<{ key: string; text: string } | null>(null);
    const [announcement, setAnnouncement] = useState('');
    const [celebrationAck, setCelebrationAck] = useState(false);
    const [streak, setStreak] = useState(0);
    const [pulseKey, setPulseKey] = useState(0);
    const [exiting, setExiting] = useState<'mini' | 'hidden' | null>(null);
    const [enter, setEnter] = useState<StageEnter>('origin');
    const [breakIdea, setBreakIdea] = useState(0);
    /** Break skipped by hand: show "ready" without faking a finished-break event (no alert). */
    const [breakSkipped, setBreakSkipped] = useState(false);
    /** The stage put the window into true full screen (so leaving the stage undoes it). */
    const [fullscreen, setFullscreen] = useState(false);
    const pickerTasks = useMemo(() => liveTasks
        .filter(isTaskActionable)
        .sort((a, b) => Number(b.isFocusedToday === true) - Number(a.isFocusedToday === true)), [liveTasks]);

    // Any Start opens the stage: focus or break, with or without a task, from the Today card,
    // a task row or the menu bar (shared snapshot). Re-opening is allowed once the timer stops.
    useEffect(() => {
        if (!timerState.isRunning && session.dismissed) session.clearDismissed();
        if (timerState.isRunning && !session.open && !session.dismissed) {
            const live = selectedTaskId ? useTaskStore.getState()._allTasks.find((x) => x.id === selectedTaskId) : undefined;
            setEnter(session.origin ? 'origin' : 'none');
            session.open_((live?.checklist ?? []).filter((s) => s.isCompleted).length);
        }
    }, [timerState.isRunning, selectedTaskId, session]);

    useEffect(() => { setCelebrationAck(false); }, [selectedTaskId]);
    useEffect(() => { if (total === 0 || done < total) setCelebrationAck(false); }, [done, total]);
    useEffect(() => { if (timerState.phase === 'break') setBreakIdea((i) => (i + 1) % BREAK_IDEAS); }, [timerState.phase]);
    useEffect(() => { if (timerState.isRunning) setBreakSkipped(false); }, [timerState.isRunning]);

    // The note under the card fades after a few seconds.
    useEffect(() => {
        if (!note) return;
        const timer = window.setTimeout(() => setNote((cur) => (cur?.key === note.key ? null : cur)), NOTE_MS);
        return () => window.clearTimeout(timer);
    }, [note]);

    const currentStepTitle = steps.find((s) => !s.isCompleted)?.title;
    const coachLead = coachApi.status === 'ready' ? coachApi.coach?.approach?.text : undefined;
    useEffect(() => {
        writeFocusNow(session.open ? task?.id : undefined, session.open ? (currentStepTitle ?? coachLead ?? null) : null);
    }, [session.open, task?.id, currentStepTitle, coachLead]);

    const encourage = useCallback((milestone: FocusMilestone, doneCount: number, totalCount: number, apply: (key: string, text: string) => void) => {
        const key = `${task?.id ?? 'timer'}:${milestone}:${doneCount}`;
        apply(key, tr(`focus.encourage.${milestone}`, getFallbackEncouragement(milestone, doneCount)));
        if (!task) return;
        void requestFocusEncouragement(`${task.id}:${milestone}`, { taskTitle: task.title, milestone, done: doneCount, total: totalCount }, language)
            .then((line) => { if (line) apply(key, line); });
    }, [language, task, tr]);

    // Step ticks: a light pulse, a one-line "Next" encouragement, and a screen-reader announcement.
    const prevDone = useRef<{ taskId: string | undefined; done: number } | null>(null);
    useEffect(() => {
        if (!session.open) { prevDone.current = null; return; }
        const previous = prevDone.current;
        prevDone.current = { taskId: task?.id, done };
        // A task attached (or switched) mid-session is not a tick.
        if (!previous || previous.taskId !== task?.id || done <= previous.done || total === 0) return;
        setPulseKey((k) => k + 1);
        setAnnouncement(tr('focus.stepAnnounce', 'Step {{current}} of {{total}} done').replace('{{current}}', String(done)).replace('{{total}}', String(total)));
        if (done >= total) {
            encourage('end', done, total, (key, text) => setSentence({ key, text }));
            return;
        }
        const next = steps.find((s) => !s.isCompleted);
        const nextLine = next ? tr('focus.next', 'Next: {{step}}').replace('{{step}}', next.title) : '';
        const milestone = getFocusMilestone(done, total);
        if (milestone) {
            encourage(milestone, done, total, (key, text) => setNote((cur) => (cur && cur.key !== key && cur.key.startsWith('next:') ? cur : { key, text: `${text} ${nextLine}`.trim() })));
        } else {
            setNote({ key: `next:${done}`, text: nextLine });
        }
    }, [done, total, session.open, encourage, steps, tr, task?.id]);

    // Timer milestones for screen readers.
    useEffect(() => {
        if (!session.open || !timerState.isRunning) return;
        if (timerState.remainingSeconds === 300 || timerState.remainingSeconds === 60) {
            setAnnouncement(tr('focus.timeLeft', '{{time}} remaining').replace('{{time}}', formatPomodoroClock(timerState.remainingSeconds)));
        }
    }, [session.open, timerState.isRunning, timerState.remainingSeconds, tr]);

    // Session end: streak, closing line, and the finish comes back to the full stage.
    const handledEvent = useRef<typeof lastEvent>(null);
    useEffect(() => {
        if (lastEvent === handledEvent.current) return;
        handledEvent.current = lastEvent;
        if (lastEvent !== 'focus-finished' || !session.open) return;
        setStreak(recordFocusDay());
        encourage('end', done, total, (key, text) => setSentence({ key, text }));
        if (session.presentation !== 'full') {
            setEnter(session.presentation === 'mini' ? 'mini' : 'hidden');
            session.expand();
        }
    }, [lastEvent, session, done, total, encourage]);
    useEffect(() => { if (!session.open) setStreak(getFocusStreak()); }, [session.open]);

    const updateSnapshot = useCallback((fn: (prev: ReturnType<typeof reconcilePomodoroSnapshot>) => ReturnType<typeof reconcilePomodoroSnapshot>) => {
        commit((prev) => fn(reconcilePomodoroSnapshot(prev, Date.now(), autoStart)));
    }, [autoStart, commit]);

    const setPhase = useCallback((phase: 'focus' | 'break', running: boolean) => {
        updateSnapshot((p) => ({
            ...p,
            timerState: { ...resetPomodoroState(p.timerState, p.durations, phase), isRunning: running },
            lastEvent: null,
            updatedAtMs: Date.now(),
        }));
    }, [updateSnapshot]);

    /** Pause / resume. In overtime, pausing ends the session and the check-in follows. */
    const toggleRun = useCallback(() => {
        commit((prev) => togglePomodoroSnapshot(prev, Date.now(), autoStart));
    }, [autoStart, commit]);

    const finishView = lastEvent === 'focus-finished'
        || (timerState.phase === 'focus' && total > 0 && done === total && !celebrationAck);
    const finishKind = lastEvent === 'focus-finished' ? 'session' : 'task';
    let view: FocusView = 'focus';
    if (finishView) view = 'finish';
    else if (timerState.phase === 'break') view = 'break';
    else if ((lastEvent === 'break-finished' || breakSkipped) && !timerState.isRunning) view = 'ready';
    // Live = something is still counting (or paused mid-phase): X hides instead of closing.
    const active = timerState.isRunning || view === 'focus' || view === 'break';

    const toggleFullscreen = useCallback(async () => {
        setFullscreen(await setWindowFullscreen(!(await isWindowFullscreen())));
    }, []);
    const leaveFullscreen = useCallback(() => {
        if (!fullscreen) return;
        setFullscreen(false);
        void setWindowFullscreen(false);
    }, [fullscreen]);

    const leave = useCallback((to: 'mini' | 'hidden') => {
        if (!session.open) return;
        leaveFullscreen();
        if (session.presentation === 'full' && canAnimate()) setExiting(to);
        // Minimise (button or Esc) pops the timer out into the floating window where it exists.
        if (to === 'mini' && isFocusFloatSupported()) useFocusFloatStore.getState().request();
        if (to === 'mini') session.minimise(); else session.hide();
    }, [session, leaveFullscreen]);

    const closeSession = useCallback(() => {
        leaveFullscreen();
        updateSnapshot((p) => ({ ...p, lastEvent: null, updatedAtMs: Date.now() }));
        session.close();
    }, [session, updateSnapshot, leaveFullscreen]);

    const expand = useCallback(() => {
        setEnter(session.presentation === 'mini' ? 'mini' : 'hidden');
        session.expand();
    }, [session]);

    // Esc: leave true full screen first; then minimise a live session, or close a finished one.
    useEffect(() => {
        if (!session.open || session.presentation !== 'full') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return;
            event.preventDefault();
            event.stopPropagation();
            if (session.confirmingEnd) session.cancelEnd();
            else if (fullscreen) leaveFullscreen();
            else if (active) leave('mini');
            else closeSession();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [session, active, leave, closeSession, fullscreen, leaveFullscreen]);

    // Floating timer (native always-on-top window): fed from this session, driven by its buttons.
    const floatTotalSeconds = Math.max(1, getPomodoroPhaseTotalSeconds(timerState, durations));
    const floatLive = session.open && (timerState.isRunning || view !== 'focus' || timerState.remainingSeconds < floatTotalSeconds);
    const currentStepIndex = steps.findIndex((s) => !s.isCompleted);
    const floatNextStep = currentStepIndex >= 0 ? steps.slice(currentStepIndex + 1).find((s) => !s.isCompleted)?.title ?? null : null;
    const floatState: FocusFloatState | null = floatLive ? {
        timer: timerState,
        durations,
        updatedAtMs: snapshot.updatedAtMs,
        autoStart,
        view,
        taskTitle: task?.title ?? null,
        currentStep: timerState.phase === 'focus' ? (currentStepTitle ?? coachLead ?? null) : null,
        nextStep: timerState.phase === 'focus' ? floatNextStep : null,
    } : null;
    useFocusFloatBridge({
        state: floatState,
        live: floatLive,
        presentation: session.presentation,
        handlers: {
            toggle: toggleRun,
            open: () => { if (session.open && session.presentation !== 'full') expand(); },
            startNext: () => { setNote(null); setBreakSkipped(false); setPhase('focus', true); },
            tick: () => updateSnapshot((p) => p),
        },
    });
    const floatVisible = useFocusFloatStore((s) => s.visible);
    const floatRequested = useFocusFloatStore((s) => s.requested);
    // The float replaces the in-window mini card (the pill stays as the way back inside the app).
    const floatTakesMini = isFocusFloatSupported() && (floatVisible || floatRequested);

    if (!session.open || typeof document === 'undefined') return null;

    const project = task?.projectId ? projects.find((p) => p.id === task.projectId) : undefined;
    const pickTask = (id: string | undefined) => {
        updateSnapshot((p) => ({ ...p, selectedTaskId: id, updatedAtMs: Date.now() }));
    };
    const totalSeconds = Math.max(1, getPomodoroPhaseTotalSeconds(timerState, durations));
    const inOvertime = isPomodoroInOvertime(timerState);
    const overtimeSeconds = inOvertime ? getPomodoroOvertimeSeconds(timerState) : undefined;
    // How long the session that just ended really was (with added time and overtime).
    const finishedMinutes = timerState.lastFocusSeconds ? Math.max(1, Math.round(timerState.lastFocusSeconds / 60)) : durations.focusMinutes;
    const elapsedMinutes = Math.max(1, Math.round((totalSeconds - timerState.remainingSeconds) / 60));

    const markDone = async (): Promise<FocusUndo | null> => {
        if (!task) return null;
        // The task's row in the list behind plays the completion sequence; this click owns the sound.
        if (task.status !== 'done') beginCompletion(task.id, { sound: true });
        const undo = await markFocusTaskDone(task.id);
        if (!undo) {
            cancelCompletion(task.id);
            const message = tr('task.updateFailed', 'Could not update the task');
            useUiStore.getState().showToast(message, 'error');
            return null;
        }
        updateSnapshot((p) => ({ ...p, timerState: { ...p.timerState, isRunning: false }, updatedAtMs: Date.now() }));
        return undo;
    };
    const applyAction = async (action: FocusCoachAction): Promise<FocusUndo | null> => (task ? applyFocusCoachAction(task.id, action) : null);
    const askCoach = async (text: string): Promise<FocusCoachReply> => {
        const live = task ? useTaskStore.getState()._allTasks.find((x) => x.id === task.id) ?? task : undefined;
        const { _allTasks, projects: allProjects, areas: allAreas } = useTaskStore.getState();
        const input = live
            ? buildFocusCoachInput({ task: live, tasks: _allTasks, projects: allProjects, areas: allAreas }, readFocusCoachFeedbackSummary())
            : { title: '', context: {} };
        return requestFocusCoachReply(input, [
            { role: 'coach', text: tr('focus.checkin.blocking', "What's in the way?") },
            { role: 'user', text },
        ], { language, tr });
    };
    const taskIsDone = () => Boolean(task && useTaskStore.getState()._allTasks.find((x) => x.id === task.id)?.status === 'done');
    const checkInBreak = (afterDone: boolean) => {
        setCelebrationAck(true);
        updateSnapshot((p) => ({
            ...p,
            selectedTaskId: afterDone ? undefined : p.selectedTaskId,
            timerState: { ...resetPomodoroState(p.timerState, p.durations, 'break'), isRunning: true },
            lastEvent: null,
            updatedAtMs: Date.now(),
        }));
    };
    /** Check-in "Almost": keep going on this task for that long, back on the running stage. */
    const extendFromCheckIn = (minutes: number) => {
        setCelebrationAck(true);
        setSentence(null);
        usePomodoroStore.getState().resumePomodoroFocus(minutes, autoStart);
    };
    const closeFromCheckIn = () => {
        const done = taskIsDone();
        leaveFullscreen();
        updateSnapshot((p) => ({
            ...p,
            selectedTaskId: done ? undefined : p.selectedTaskId,
            timerState: { ...resetPomodoroState(p.timerState, p.durations, 'focus'), isRunning: false },
            lastEvent: null,
            updatedAtMs: Date.now(),
        }));
        session.close();
    };

    const showStage = session.presentation === 'full' || exiting !== null;
    const stage = showStage && (
        <FocusStage
            key="focus-stage"
            view={view}
            finishKind={finishKind}
            phase={timerState.phase}
            task={task}
            project={project}
            remainingSeconds={timerState.remainingSeconds}
            totalSeconds={totalSeconds}
            overtimeSeconds={overtimeSeconds}
            isRunning={timerState.isRunning}
            active={active}
            confirmingEnd={session.confirmingEnd}
            steps={steps}
            coach={coachApi}
            focusMinutes={durations.focusMinutes}
            note={note?.text ?? null}
            sentence={sentence?.text ?? tr('focus.encourage.end', getFallbackEncouragement('end'))}
            breakIdea={tr(`focus.breakIdea.${breakIdea}`, 'Stand up and stretch your shoulders.')}
            announcement={announcement}
            summary={{
                minutes: finishKind === 'session' ? finishedMinutes : elapsedMinutes,
                stepsDone: done,
                stepsTotal: total,
                sessionsToday: getPomodoroFocusSessionsCompletedToday(snapshot.sessionHistory),
                streak,
            }}
            pulseKey={pulseKey}
            enter={enter}
            origin={session.origin}
            exiting={exiting}
            onExited={() => setExiting(null)}
            tr={tr}
            onToggleRun={toggleRun}
            onEnd={() => {
                // Stopping in overtime ends the session with the check-in, like Pause.
                if (inOvertime) { toggleRun(); return; }
                if (session.requestEnd(timerState.isRunning)) { leaveFullscreen(); setPhase('focus', false); }
            }}
            onConfirmEnd={() => { leaveFullscreen(); setPhase(timerState.phase, false); session.close(); }}
            onCancelEnd={session.cancelEnd}
            onMinimise={() => leave('mini')}
            onHide={() => { if (active) leave('hidden'); else closeSession(); }}
            onSkipBreak={() => { setBreakSkipped(true); setPhase('focus', false); }}
            onStartNext={() => { setNote(null); setBreakSkipped(false); setPhase('focus', true); }}
            onToggleStep={stepsApi.toggle}
            onRenameStep={stepsApi.rename}
            onRemoveStep={stepsApi.remove}
            onAddStep={stepsApi.add}
            onMarkDone={markDone}
            onApplyAction={applyAction}
            onAskCoach={askCoach}
            onCheckInBreak={checkInBreak}
            onCloseSession={closeFromCheckIn}
            onExtend={extendFromCheckIn}
            pickerTasks={pickerTasks}
            onPickTask={pickTask}
            fullscreen={fullscreen}
            onToggleFullscreen={() => { void toggleFullscreen(); }}
            onTakeBreak={() => { setCelebrationAck(true); setPhase('break', true); }}
            onKeepGoing={() => {
                setCelebrationAck(true);
                setSentence(null);
                if (lastEvent === 'focus-finished' || !timerState.isRunning) setPhase('focus', true);
            }}
        />
    );

    return createPortal(
        <>
            {stage}
            {session.presentation === 'mini' && !floatTakesMini && (
                <FocusMini
                    task={task}
                    phase={timerState.phase}
                    remainingSeconds={timerState.remainingSeconds}
                    totalSeconds={totalSeconds}
                    overtimeSeconds={overtimeSeconds}
                    isRunning={timerState.isRunning}
                    steps={steps}
                    position={session.miniPosition}
                    delayed={exiting === 'mini'}
                    takeFocus={session.previous === 'full'}
                    tr={tr}
                    onToggleRun={toggleRun}
                    onExpand={expand}
                    onHide={session.hide}
                    onToggleStep={stepsApi.toggle}
                    onMove={session.setMiniPosition}
                    onFloat={isFocusFloatSupported() ? () => useFocusFloatStore.getState().request() : undefined}
                />
            )}
            {(session.presentation === 'hidden' || (session.presentation === 'mini' && floatTakesMini)) && (
                <FocusPill
                    takeFocus={session.previous !== null}
                    phase={timerState.phase}
                    remainingSeconds={timerState.remainingSeconds}
                    totalSeconds={totalSeconds}
                    overtimeSeconds={overtimeSeconds}
                    isRunning={timerState.isRunning}
                    tr={tr}
                    onExpand={expand}
                />
            )}
            {session.presentation !== 'full' && (
                <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
            )}
        </>,
        document.body,
    );
}
