import { useCallback, useEffect, useRef, useState } from 'react';
import {
    FOCUS_COACH_MAX_EXCHANGES,
    FOCUS_COACH_MIN_AUTO_STEPS,
    buildFocusCoachInput,
    isDigitalFocusTask,
    type FocusCoach,
    type FocusCoachAction,
    type FocusCoachFeedbackEntry,
    type FocusCoachFeedbackKind,
    type FocusCoachFeedbackVerdict,
    type FocusCoachInput,
    type FocusCoachReply,
    type FocusCoachStep,
    type FocusCoachTurn,
} from './ai/focus-coach-ai';
import {
    addFocusChecklistItems,
    applyFocusCoachAction,
    replaceFocusChecklistItems,
    readFocusTask,
    type FocusAiService,
    type FocusUndo,
} from './focus-coach-service';
import type { Language } from './i18n';
import { useTaskStore } from './store';

export type FocusCoachStatus = 'idle' | 'loading' | 'ready' | 'leaving' | 'dismissed';

export interface FocusCoachExchange {
    id: string;
    answer: string;
    reply?: FocusCoachReply;
    leaving?: boolean;
    feedback?: FocusCoachFeedbackVerdict;
}

/**
 * - shown: the suggested steps are listed with "Add to checklist".
 * - offered: the task already has steps; the suggestions wait behind "Suggest more steps".
 * - added: on the checklist (`auto` = the coach added them by itself, `ids` = those items).
 * - removed: auto-added steps were taken off after "Not useful"; `restore` puts them back.
 */
export type StepsState =
    | { state: 'shown' }
    | { state: 'offered' }
    | { state: 'adding' }
    | { state: 'added'; undo: FocusUndo; auto?: boolean; ids?: string[] }
    | { state: 'removed'; restore: () => Promise<boolean> }
    | { state: 'leaving' }
    | { state: 'dismissed' };

export interface FocusCoachHookServices {
    ai: Pick<FocusAiService, 'requestFocusCoach' | 'requestFocusCoachReply'>;
    readFeedbackSummary: () => string[];
    recordFeedback: (entry: FocusCoachFeedbackEntry) => unknown;
    leaveDelayMs: () => number;
    /**
     * When the task has no checklist, add the coach's steps to it on its own (with Undo); when it has
     * one, keep the suggestions behind "Suggest more steps". Off: steps are only suggested.
     */
    autoAddSteps?: boolean;
    /** The focus timer's current length in minutes (gives the coach a reference for its estimate). */
    readTimerMinutes?: () => number | undefined;
}

const MAX_ANSWER_CHARS = 160;

export function buildFocusCoachInputForTask(taskId: string, feedbackSummary: string[], timerMinutes?: number): FocusCoachInput | null {
    const task = readFocusTask(taskId);
    if (!task) return null;
    const { _allTasks, projects, areas } = useTaskStore.getState();
    const input = buildFocusCoachInput({ task, tasks: _allTasks, projects, areas }, feedbackSummary);
    if (timerMinutes && Number.isFinite(timerMinutes) && timerMinutes > 0) input.timerMinutes = Math.round(timerMinutes);
    return input;
}

const stepKey = (title: string) => title.trim().toLowerCase();

export function useFocusCoach(
    services: FocusCoachHookServices,
    taskId: string | undefined,
    active: boolean,
    language: Language,
    tr: (key: string, fallback: string) => string,
) {
    const [coach, setCoach] = useState<FocusCoach | null>(null);
    const [status, setStatus] = useState<FocusCoachStatus>('idle');
    const [exchanges, setExchanges] = useState<FocusCoachExchange[]>([]);
    const [steps, setSteps] = useState<StepsState>({ state: 'shown' });
    /** The coach's steps that are not on the checklist yet. */
    const [suggested, setSuggested] = useState<FocusCoachStep[]>([]);
    const [coachFeedback, setCoachFeedback] = useState<FocusCoachFeedbackVerdict | undefined>();
    const [collapsed, setCollapsed] = useState(false);
    const generation = useRef(0);
    const trRef = useRef(tr);
    trRef.current = tr;
    const servicesRef = useRef(services);
    servicesRef.current = services;

    useEffect(() => {
        generation.current += 1;
        setCoach(null);
        setExchanges([]);
        setSteps({ state: 'shown' });
        setSuggested([]);
        setCoachFeedback(undefined);
        setCollapsed(false);
        if (!active || !taskId) { setStatus('idle'); return; }
        const input = buildFocusCoachInputForTask(taskId, servicesRef.current.readFeedbackSummary(), servicesRef.current.readTimerMinutes?.());
        if (!input) { setStatus('idle'); return; }
        const run = generation.current;
        setStatus('loading');
        void servicesRef.current.ai.requestFocusCoach(`${taskId}:${input.title}`, input, { language, tr: trRef.current, seed: input.title.length })
            .then(async (result) => {
                if (generation.current !== run) return;
                const checklist = readFocusTask(taskId)?.checklist ?? [];
                const have = new Set(checklist.map((item) => stepKey(item.title)));
                const fresh = result.steps.filter((step) => !have.has(stepKey(step.title)));
                setCoach(result);
                setSuggested(fresh);
                setStatus('ready');
                if (!servicesRef.current.autoAddSteps || fresh.length === 0) return;
                if (checklist.length > 0) { setSteps({ state: 'offered' }); return; }
                if (fresh.length < FOCUS_COACH_MIN_AUTO_STEPS) return;
                // No checklist yet: the coach writes its steps in, like a good assistant (with Undo).
                setSteps({ state: 'adding' });
                const added = await addFocusChecklistItems(taskId, fresh.map((step) => step.title));
                if (generation.current !== run) return;
                setSteps(added ? { state: 'added', undo: added, auto: true, ids: added.ids } : { state: 'shown' });
            });
    }, [active, taskId, language]);

    const leave = (finish: () => void, start: () => void) => {
        start();
        const delay = servicesRef.current.leaveDelayMs();
        if (delay > 0) setTimeout(finish, delay);
        else finish();
    };

    const record = useCallback((kind: FocusCoachFeedbackKind, verdict: FocusCoachFeedbackVerdict) => {
        const task = taskId ? readFocusTask(taskId) : undefined;
        if (!task) return;
        servicesRef.current.recordFeedback({
            taskId: task.id,
            taskTitle: task.title,
            kind,
            verdict,
            at: new Date().toISOString(),
            ...(kind === 'coach' && coach?.approach ? { approach: coach.approach.kind } : {}),
            digital: isDigitalFocusTask(task.title),
        });
    }, [coach, taskId]);

    const rateCoach = useCallback((verdict: FocusCoachFeedbackVerdict) => {
        record('coach', verdict);
        setCoachFeedback(verdict);
        if (verdict === 'useful') return;
        leave(() => setStatus('dismissed'), () => setStatus('leaving'));
    }, [record]);

    const rateSteps = useCallback((verdict: FocusCoachFeedbackVerdict) => {
        record('steps', verdict);
        if (verdict === 'useful') return;
        if (steps.state === 'added' && steps.auto && taskId) {
            // The coach put these on the checklist by itself: "Not useful" takes them off again (undoable).
            const current = steps;
            const titles = (readFocusTask(taskId)?.checklist ?? [])
                .filter((item) => current.ids?.includes(item.id) && !item.isCompleted)
                .map((item) => item.title);
            void current.undo.undo().then((ok) => {
                if (!ok) return;
                setSteps({
                    state: 'removed',
                    restore: async () => {
                        const again = titles.length ? await addFocusChecklistItems(taskId, titles) : null;
                        if (!again) return false;
                        setSteps({ state: 'added', undo: again, auto: true, ids: again.ids });
                        return true;
                    },
                });
            });
            return;
        }
        leave(() => setSteps({ state: 'dismissed' }), () => setSteps({ state: 'leaving' }));
    }, [record, steps, taskId]);

    const patchExchange = (id: string, fn: (e: FocusCoachExchange) => FocusCoachExchange) => {
        setExchanges((list) => list.map((e) => (e.id === id ? fn(e) : e)));
    };

    const rateReply = useCallback((id: string, verdict: FocusCoachFeedbackVerdict) => {
        record('reply', verdict);
        if (verdict === 'useful') { patchExchange(id, (e) => ({ ...e, feedback: verdict })); return; }
        leave(
            () => setExchanges((list) => list.filter((e) => e.id !== id)),
            () => patchExchange(id, (e) => ({ ...e, leaving: true, feedback: verdict })),
        );
    }, [record]);

    const answer = useCallback(async (text: string) => {
        const clean = text.trim().slice(0, MAX_ANSWER_CHARS);
        if (!clean || !taskId || !coach || exchanges.length >= FOCUS_COACH_MAX_EXCHANGES) return;
        if (exchanges.some((e) => !e.reply)) return;
        const input = buildFocusCoachInputForTask(taskId, servicesRef.current.readFeedbackSummary(), servicesRef.current.readTimerMinutes?.());
        if (!input) return;
        const id = `x${exchanges.length}-${Date.now()}`;
        const turns: FocusCoachTurn[] = [];
        const estimate = coach.estimateMinutes ? `About ${coach.estimateMinutes} min${coach.estimateNote ? ` (${coach.estimateNote})` : ''}.` : '';
        const opener = [estimate, coach.approach?.text, coach.question?.text].filter(Boolean).join(' ');
        if (opener) turns.push({ role: 'coach', text: opener });
        for (const e of exchanges) {
            turns.push({ role: 'user', text: e.answer });
            if (e.reply) turns.push({ role: 'coach', text: e.reply.reply });
        }
        turns.push({ role: 'user', text: clean });
        setExchanges((list) => [...list, { id, answer: clean }]);
        const run = generation.current;
        const reply = await servicesRef.current.ai.requestFocusCoachReply(input, turns, { language, tr: trRef.current });
        if (generation.current !== run) return;
        patchExchange(id, (e) => ({ ...e, reply }));
    }, [coach, exchanges, language, taskId]);

    const applyAction = useCallback(async (action: FocusCoachAction): Promise<FocusUndo | null> => (
        taskId ? applyFocusCoachAction(taskId, action) : null
    ), [taskId]);

    const addSteps = useCallback(async () => {
        if (!taskId || !suggested.length) return;
        setSteps({ state: 'adding' });
        const undo = await addFocusChecklistItems(taskId, suggested.map((s) => s.title));
        setSteps(undo ? { state: 'added', undo, ids: undo.ids } : { state: 'shown' });
    }, [suggested, taskId]);

    const undoSteps = useCallback(async () => {
        if (steps.state === 'removed') { await steps.restore(); return; }
        if (steps.state !== 'added') return;
        const ok = await steps.undo.undo();
        if (ok) setSteps({ state: steps.auto ? 'dismissed' : 'shown' });
    }, [steps]);

    /** "Suggest more steps": show the coach's extra steps for a task that already has a checklist. */
    const revealSteps = useCallback(() => {
        setSteps((current) => (current.state === 'offered' ? { state: 'shown' } : current));
    }, []);

    /**
     * "Update steps" after an answer: the coach's open steps make way for the refined ones (the
     * user's own and ticked steps stay). Undo restores the checklist and the previous state.
     */
    const updateSteps = useCallback(async (next: readonly FocusCoachStep[]): Promise<FocusUndo | null> => {
        if (!taskId || next.length === 0) return null;
        const before = steps;
        const replaceIds = before.state === 'added' ? before.ids ?? [] : [];
        const result = await replaceFocusChecklistItems(taskId, next.map((step) => step.title), replaceIds);
        if (!result) return null;
        setSteps({ state: 'added', undo: result, auto: true, ids: result.ids });
        return {
            undo: async () => {
                const ok = await result.undo();
                if (ok) setSteps(before);
                return ok;
            },
        };
    }, [steps, taskId]);

    return {
        coach,
        status,
        exchanges,
        steps,
        suggested,
        coachFeedback,
        collapsed,
        canReply: Boolean(coach) && exchanges.length < FOCUS_COACH_MAX_EXCHANGES && !exchanges.some((e) => !e.reply),
        toggleCollapsed: () => setCollapsed((c) => !c),
        answer,
        applyAction,
        addSteps,
        undoSteps,
        revealSteps,
        updateSteps,
        rateCoach,
        rateSteps,
        rateReply,
    };
}

export type FocusCoachApi = ReturnType<typeof useFocusCoach>;
