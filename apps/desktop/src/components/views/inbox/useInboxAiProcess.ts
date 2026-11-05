import { useCallback, useMemo, useRef, useState } from 'react';
import type { InboxProcessSuggestion, Language, RoutingCorrection } from '@stride/core';

import { saveRoutingCorrection } from '../../../lib/ai-routing';
import {
    applyInboxProcessing,
    generateInboxProcessing,
    rememberInboxSuggestions,
    undoInboxProcessing,
    type AppliedInboxProcess,
    type InboxProcessOutcome,
} from '../../../lib/inbox-process-service';
import { showUndoToast } from '../../../lib/undo-registry';
import { useUiStore } from '../../../store/ui-store';
import type { CaptureText } from '../../capture/useCaptureText';

export type InboxReviewRow = InboxProcessSuggestion & {
    decision: 'accept' | 'skip';
    /** What the AI originally proposed, so a user change can be learned as a routing correction. */
    ai: Pick<InboxProcessSuggestion, 'areaName' | 'newAreaName' | 'projectName' | 'newProjectTitle'>;
};

export type InboxAiPhase = 'idle' | 'thinking' | 'review' | 'applying';
export type InboxAiNotice = 'disabled' | 'limited' | 'failed' | null;

export type UseInboxAiProcessOptions = {
    t: CaptureText;
    language?: Language;
    /** Non-AI fallback: the guided, one-by-one Process Inbox flow. */
    onManualProcess: () => void;
    /** Test seams. */
    generate?: (language: Language) => Promise<InboxProcessOutcome>;
    apply?: (suggestions: readonly InboxProcessSuggestion[], label: string) => Promise<AppliedInboxProcess>;
    undo?: (changeId: string) => Promise<boolean>;
    onCorrection?: (entry: Omit<RoutingCorrection, 'at'>) => void;
};

const toRow = (suggestion: InboxProcessSuggestion): InboxReviewRow => ({
    ...suggestion,
    decision: suggestion.needsYou ? 'skip' : 'accept',
    ai: {
        areaName: suggestion.areaName,
        newAreaName: suggestion.newAreaName,
        projectName: suggestion.projectName,
        newProjectTitle: suggestion.newProjectTitle,
    },
});

const stripRow = ({ decision: _decision, ai: _ai, ...suggestion }: InboxReviewRow): InboxProcessSuggestion => suggestion;

export function useInboxAiProcess({
    t,
    language = 'en',
    onManualProcess,
    generate = generateInboxProcessing,
    apply = applyInboxProcessing,
    undo = undoInboxProcessing,
    onCorrection = saveRoutingCorrection,
}: UseInboxAiProcessOptions) {
    const [phase, setPhase] = useState<InboxAiPhase>('idle');
    const [rows, setRows] = useState<InboxReviewRow[]>([]);
    const [summary, setSummary] = useState('');
    const [notice, setNotice] = useState<InboxAiNotice>(null);
    const runRef = useRef(0);
    const showToast = useUiStore((state) => state.showToast);

    const start = useCallback(async () => {
        if (phase === 'thinking' || phase === 'applying') return;
        const run = ++runRef.current;
        setNotice(null);
        setPhase('thinking');
        const outcome = await generate(language);
        if (runRef.current !== run) return;
        if (outcome.status === 'ok') {
            setRows(outcome.proposal.items.map(toRow));
            setSummary(outcome.proposal.summary);
            setPhase('review');
            return;
        }
        setPhase('idle');
        if (outcome.reason === 'empty') return;
        setNotice(outcome.reason);
        // AI is off or unconfigured: go straight to the guided one-by-one flow.
        if (outcome.reason === 'disabled') onManualProcess();
    }, [generate, language, onManualProcess, phase]);

    const cancel = useCallback(() => {
        runRef.current += 1;
        setRows([]);
        setSummary('');
        setPhase('idle');
    }, []);

    const dismissNotice = useCallback(() => setNotice(null), []);

    const setDecision = useCallback((taskId: string, decision: 'accept' | 'skip') => {
        setRows((current) => current.map((row) => (row.taskId === taskId ? { ...row, decision } : row)));
    }, []);

    const updateRow = useCallback((taskId: string, patch: Partial<InboxProcessSuggestion>) => {
        setRows((current) => current.map((row) => (row.taskId === taskId
            ? { ...row, ...patch, needsYou: false, needsYouReason: undefined, decision: 'accept' }
            : row)));
    }, []);

    const acceptAll = useCallback(() => {
        setRows((current) => current.map((row) => (row.needsYou ? row : { ...row, decision: 'accept' })));
    }, []);

    const acceptedCount = useMemo(() => rows.filter((row) => row.decision === 'accept').length, [rows]);

    const applyAccepted = useCallback(async () => {
        if (phase !== 'review') return;
        const accepted = rows.filter((row) => row.decision === 'accept');
        const leftBehind = rows.filter((row) => row.decision !== 'accept');
        if (accepted.length === 0) {
            rememberInboxSuggestions(leftBehind.map(stripRow));
            cancel();
            return;
        }
        setPhase('applying');
        try {
            const label = t('inboxHub.appliedLabel', 'Processed {{count}} Inbox items', { count: accepted.length });
            const result = await apply(accepted.map(stripRow), label);
            for (const row of accepted) {
                const areaChanged = (row.areaName ?? row.newAreaName) !== (row.ai.areaName ?? row.ai.newAreaName);
                const projectChanged = (row.projectName ?? row.newProjectTitle) !== (row.ai.projectName ?? row.ai.newProjectTitle);
                if (!areaChanged && !projectChanged) continue;
                onCorrection({
                    text: row.title,
                    ...(row.ai.areaName ?? row.ai.newAreaName ? { fromArea: row.ai.areaName ?? row.ai.newAreaName } : {}),
                    ...(row.ai.projectName ?? row.ai.newProjectTitle ? { fromProject: row.ai.projectName ?? row.ai.newProjectTitle } : {}),
                    ...(row.areaName ?? row.newAreaName ? { toArea: row.areaName ?? row.newAreaName } : {}),
                    ...(row.projectName ?? row.newProjectTitle ? { toProject: row.projectName ?? row.newProjectTitle } : {}),
                });
            }
            rememberInboxSuggestions(leftBehind.map(stripRow));
            const moved = result.updatedTaskIds.length + result.deletedTaskIds.length;
            const message = t('inboxHub.applied', 'Processed {{count}} items', { count: moved })
                + (result.failed.length ? ` · ${t('inboxHub.someSkipped', '{{count}} left in Inbox', { count: result.failed.length })}` : '');
            if (result.changeId) {
                const changeId = result.changeId;
                showUndoToast(message, () => {
                    void undo(changeId).then((ok) => {
                        showToast(ok
                            ? t('inboxHub.undone', 'Inbox processing undone')
                            : t('inboxHub.undoFailed', 'Couldn’t undo everything. Check the Inbox.'), ok ? 'info' : 'error');
                    });
                });
            } else {
                showToast(message, result.failed.length ? 'error' : 'info');
            }
            setRows([]);
            setSummary('');
            setPhase('idle');
        } catch {
            setPhase('review');
            showToast(t('inboxHub.applyFailed', 'Couldn’t apply the changes. Nothing was lost.'), 'error');
        }
    }, [apply, cancel, onCorrection, phase, rows, showToast, t, undo]);

    return {
        phase,
        rows,
        summary,
        notice,
        acceptedCount,
        start,
        cancel,
        dismissNotice,
        setDecision,
        updateRow,
        acceptAll,
        applyAccepted,
    };
}

export type InboxAiProcessController = ReturnType<typeof useInboxAiProcess>;
