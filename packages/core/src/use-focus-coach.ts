import { useCallback, useEffect, useRef, useState } from 'react';
import {
    FOCUS_COACH_MAX_EXCHANGES,
    buildFocusCoachInput,
    isDigitalFocusTask,
    type FocusCoach,
    type FocusCoachAction,
    type FocusCoachFeedbackEntry,
    type FocusCoachFeedbackKind,
    type FocusCoachFeedbackVerdict,
    type FocusCoachInput,
    type FocusCoachReply,
    type FocusCoachTurn,
} from './ai/focus-coach-ai';
import {
    addFocusChecklistItems,
    applyFocusCoachAction,
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

export type StepsState = { state: 'shown' } | { state: 'adding' } | { state: 'added'; undo: FocusUndo } | { state: 'leaving' } | { state: 'dismissed' };

export interface FocusCoachHookServices {
    ai: Pick<FocusAiService, 'requestFocusCoach' | 'requestFocusCoachReply'>;
    readFeedbackSummary: () => string[];
    recordFeedback: (entry: FocusCoachFeedbackEntry) => unknown;
    leaveDelayMs: () => number;
}

const MAX_ANSWER_CHARS = 160;

export function buildFocusCoachInputForTask(taskId: string, feedbackSummary: string[]): FocusCoachInput | null {
    const task = readFocusTask(taskId);
    if (!task) return null;
    const { _allTasks, projects, areas } = useTaskStore.getState();
    return buildFocusCoachInput({ task, tasks: _allTasks, projects, areas }, feedbackSummary);
}

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
        setCoachFeedback(undefined);
        setCollapsed(false);
        if (!active || !taskId) { setStatus('idle'); return; }
        const input = buildFocusCoachInputForTask(taskId, servicesRef.current.readFeedbackSummary());
        if (!input) { setStatus('idle'); return; }
        const run = generation.current;
        setStatus('loading');
        void servicesRef.current.ai.requestFocusCoach(`${taskId}:${input.title}`, input, { language, tr: trRef.current, seed: input.title.length })
            .then((result) => {
                if (generation.current !== run) return;
                setCoach(result);
                setStatus('ready');
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
        leave(() => setSteps({ state: 'dismissed' }), () => setSteps({ state: 'leaving' }));
    }, [record]);

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
        const input = buildFocusCoachInputForTask(taskId, servicesRef.current.readFeedbackSummary());
        if (!input) return;
        const id = `x${exchanges.length}-${Date.now()}`;
        const turns: FocusCoachTurn[] = [];
        const opener = [coach.approach?.text, coach.question?.text].filter(Boolean).join(' ');
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
        if (!taskId || !coach?.steps.length) return;
        setSteps({ state: 'adding' });
        const undo = await addFocusChecklistItems(taskId, coach.steps.map((s) => s.title));
        setSteps(undo ? { state: 'added', undo } : { state: 'shown' });
    }, [coach, taskId]);

    const undoSteps = useCallback(async () => {
        if (steps.state !== 'added') return;
        const ok = await steps.undo.undo();
        if (ok) setSteps({ state: 'shown' });
    }, [steps]);

    return {
        coach,
        status,
        exchanges,
        steps,
        coachFeedback,
        collapsed,
        canReply: Boolean(coach) && exchanges.length < FOCUS_COACH_MAX_EXCHANGES && !exchanges.some((e) => !e.reply),
        toggleCollapsed: () => setCollapsed((c) => !c),
        answer,
        applyAction,
        addSteps,
        undoSteps,
        rateCoach,
        rateSteps,
        rateReply,
    };
}

export type FocusCoachApi = ReturnType<typeof useFocusCoach>;
