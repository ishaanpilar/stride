import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    generateUUID,
    updateTaskFromLatest,
    type Language,
    type Task,
    type TaskDraft,
    type TaskDraftSetter,
    type TaskFillCurrent,
    type TaskFillProposal,
    type TaskFillResult,
} from '@stride/core';
import { requestTaskFill } from '../../lib/task-fill-ai-service';
import { reportError } from '../../lib/report-error';

type DraftFieldPatch = Partial<Pick<TaskDraft, 'projectId' | 'areaId' | 'sectionId' | 'contexts' | 'tags' | 'priority' | 'timeEstimate' | 'dueDate' | 'startTime'>>;

type AppliedEntry = {
    proposals: TaskFillProposal[];
    previous: DraftFieldPatch;
    checklistIds: string[];
};

export type TaskFillStatus = 'idle' | 'loading' | 'ready';

type UseTaskFillAiArgs = {
    task: Task;
    draft: TaskDraft;
    setField: TaskDraftSetter;
    /** AI on and the editor open; the button is hidden otherwise. */
    enabled: boolean;
    knownContexts: readonly string[];
    knownTags: readonly string[];
    language: Language;
    /** Test seam. */
    request?: typeof requestTaskFill;
};

const splitTokens = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

export const toTaskFillCurrent = (draft: TaskDraft, task: Task): TaskFillCurrent => ({
    title: draft.title,
    description: draft.description,
    projectId: draft.projectId || undefined,
    areaId: draft.areaId || undefined,
    contexts: splitTokens(draft.contexts),
    tags: splitTokens(draft.tags),
    priority: draft.priority || undefined,
    timeEstimate: draft.timeEstimate || undefined,
    dueDate: draft.dueDate || undefined,
    startTime: draft.startTime || undefined,
    checklistCount: (task.checklist ?? []).length,
});

/** The empty-field-only rule, re-checked live: a proposal disappears once the user fills its field. */
export function isTaskFillProposalStillEmpty(proposal: TaskFillProposal, draft: TaskDraft, task: Task): boolean {
    switch (proposal.field) {
        case 'destination': return !draft.projectId && !draft.areaId;
        case 'contexts': return splitTokens(draft.contexts).length === 0;
        case 'tags': return splitTokens(draft.tags).length === 0;
        case 'priority': return !draft.priority;
        case 'timeEstimate': return !draft.timeEstimate;
        case 'dueDate': return !draft.dueDate;
        case 'startTime': return !draft.startTime;
        case 'checklist': return (task.checklist ?? []).length === 0;
        default: return false;
    }
}

const proposalKey = (proposal: TaskFillProposal) => proposal.field;

export function useTaskFillAi({
    task,
    draft,
    setField,
    enabled,
    knownContexts,
    knownTags,
    language,
    request = requestTaskFill,
}: UseTaskFillAiArgs) {
    const [status, setStatus] = useState<TaskFillStatus>('idle');
    const [result, setResult] = useState<TaskFillResult | null>(null);
    const [applied, setApplied] = useState<AppliedEntry[]>([]);
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const requestIdRef = useRef(0);

    useEffect(() => {
        if (enabled) return;
        requestIdRef.current += 1;
        setStatus('idle');
        setResult(null);
        setApplied((prev) => (prev.length ? [] : prev));
    }, [enabled]);

    const run = useCallback(async () => {
        if (!enabled || status === 'loading' || !draftRef.current.title.trim()) return;
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setStatus('loading');
        try {
            const next = await request({
                task,
                current: toTaskFillCurrent(draftRef.current, task),
                knownContexts,
                knownTags,
                language,
            });
            if (requestIdRef.current !== requestId) return;
            setResult(next);
            setApplied([]);
        } catch (error) {
            if (requestIdRef.current !== requestId) return;
            reportError('Fill with AI failed', error);
            setResult({ proposals: [], source: 'fallback' });
        } finally {
            if (requestIdRef.current === requestId) setStatus('ready');
        }
    }, [enabled, knownContexts, knownTags, language, request, status, task]);

    const appliedFields = useMemo(() => new Set(applied.flatMap((entry) => entry.proposals.map(proposalKey))), [applied]);

    const proposals = useMemo(() => (result?.proposals ?? []).filter((proposal) => (
        !appliedFields.has(proposalKey(proposal)) && isTaskFillProposalStillEmpty(proposal, draft, task)
    )), [appliedFields, draft, result, task]);

    const applyProposals = useCallback((items: TaskFillProposal[]) => {
        if (items.length === 0) return;
        const current = draftRef.current;
        const previous: DraftFieldPatch = {};
        const checklistIds: string[] = [];
        const remember = <K extends keyof DraftFieldPatch>(field: K) => {
            if (!(field in previous)) previous[field] = current[field] as DraftFieldPatch[K];
        };
        for (const proposal of items) {
            switch (proposal.field) {
                case 'destination':
                    remember('projectId'); remember('areaId'); remember('sectionId');
                    setField('projectId', proposal.kind === 'project' ? proposal.id : '');
                    setField('areaId', proposal.kind === 'area' ? proposal.id : '');
                    setField('sectionId', '');
                    break;
                case 'contexts':
                case 'tags':
                    remember(proposal.field);
                    setField(proposal.field, proposal.values.join(', '));
                    break;
                case 'priority':
                    remember('priority');
                    setField('priority', proposal.value);
                    break;
                case 'timeEstimate':
                    remember('timeEstimate');
                    setField('timeEstimate', proposal.value);
                    break;
                case 'dueDate':
                case 'startTime':
                    remember(proposal.field);
                    setField(proposal.field, proposal.value);
                    break;
                case 'checklist': {
                    const newItems = proposal.values.map((title) => ({ id: generateUUID(), title, isCompleted: false }));
                    checklistIds.push(...newItems.map((item) => item.id));
                    void updateTaskFromLatest(task.id, (latest) => ({ checklist: [...(latest.checklist ?? []), ...newItems] }))
                        .catch((error) => reportError('Failed to add AI checklist steps', error));
                    break;
                }
            }
        }
        setApplied((prev) => [...prev, { proposals: items, previous, checklistIds }]);
    }, [setField, task.id]);

    const apply = useCallback((proposal: TaskFillProposal) => applyProposals([proposal]), [applyProposals]);
    const applyAll = useCallback(() => applyProposals(proposals), [applyProposals, proposals]);

    const undo = useCallback(() => {
        const last = applied[applied.length - 1];
        if (!last) return;
        for (const [field, value] of Object.entries(last.previous) as [keyof DraftFieldPatch, DraftFieldPatch[keyof DraftFieldPatch]][]) {
            setField(field, value as never);
        }
        if (last.checklistIds.length) {
            const ids = new Set(last.checklistIds);
            void updateTaskFromLatest(task.id, (latest) => ({ checklist: (latest.checklist ?? []).filter((item) => !ids.has(item.id)) }))
                .catch((error) => reportError('Failed to undo AI checklist steps', error));
        }
        setApplied((prev) => prev.slice(0, -1));
    }, [applied, setField, task.id]);

    const dismiss = useCallback(() => {
        requestIdRef.current += 1;
        setStatus('idle');
        setResult(null);
        setApplied([]);
    }, []);

    return {
        available: enabled,
        status,
        source: result?.source ?? null,
        hasResult: result !== null,
        proposals,
        appliedCount: applied.reduce((sum, entry) => sum + entry.proposals.length, 0),
        canUndo: applied.length > 0,
        run,
        apply,
        applyAll,
        undo,
        dismiss,
    };
}

export type TaskFillAi = ReturnType<typeof useTaskFillAi>;
