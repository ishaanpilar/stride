import { useCallback, useEffect, useRef, useState } from 'react';
import type { InboxProcessSuggestion, Language } from '@stride/core';

import {
    applyInboxProcessing,
    generateInboxProcessing,
    rememberInboxSuggestions,
    undoInboxProcessing,
    type AppliedInboxProcess,
    type InboxProcessOutcome,
} from '../../lib/inbox-process-service';
import { reportError } from '../../lib/report-error';

/** How long "Sorted N · Undo" stays (the undo window in the panel). */
export const PANEL_SORT_RESULT_MS = 10_000;

export type PanelSortPhase = 'idle' | 'sorting' | 'undoing';
export type PanelSortNotice = 'disabled' | 'limited' | 'failed' | 'undo-failed' | null;
export type PanelSortResult = {
    /** Items moved out of the Inbox. */
    sorted: number;
    /** Items left in the Inbox for the user to decide (unsure, new project/area, duplicates). */
    needYou: number;
    changeId: string | null;
};

/**
 * In the panel there is no review screen, so only suggestions that need no decision are applied:
 * the model was sure, the destination already exists, and nothing is deleted. Everything else stays
 * in the Inbox with its suggestion remembered on the row, for "Review in Stride".
 */
export function isConfidentInboxSuggestion(suggestion: InboxProcessSuggestion): boolean {
    return !suggestion.needsYou
        && suggestion.kind !== 'delete'
        && !suggestion.newProjectTitle
        && !suggestion.newAreaName;
}

export type UsePanelInboxSortOptions = {
    language: Language;
    /** Label for the change-log entry (one undoable batch). */
    label: (count: number) => string;
    /** Data changed: save, tell the main window, re-read. */
    onChanged: () => Promise<void> | void;
    /** Test seams. */
    generate?: (language: Language) => Promise<InboxProcessOutcome>;
    apply?: (suggestions: readonly InboxProcessSuggestion[], label: string) => Promise<AppliedInboxProcess>;
    undo?: (changeId: string) => Promise<boolean>;
    remember?: (suggestions: readonly InboxProcessSuggestion[]) => void;
};

export function usePanelInboxSort({
    language,
    label,
    onChanged,
    generate = generateInboxProcessing,
    apply = applyInboxProcessing,
    undo = undoInboxProcessing,
    remember = rememberInboxSuggestions,
}: UsePanelInboxSortOptions) {
    const [phase, setPhase] = useState<PanelSortPhase>('idle');
    const [result, setResult] = useState<PanelSortResult | null>(null);
    const [notice, setNotice] = useState<PanelSortNotice>(null);
    const timerRef = useRef<number | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => () => {
        mountedRef.current = false;
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    }, []);

    const showResult = useCallback((next: PanelSortResult | null) => {
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        setResult(next);
        if (next) timerRef.current = window.setTimeout(() => setResult(null), PANEL_SORT_RESULT_MS);
    }, []);

    const sort = useCallback(async () => {
        if (phase !== 'idle') return;
        setNotice(null);
        showResult(null);
        setPhase('sorting');
        try {
            const outcome = await generate(language);
            if (!mountedRef.current) return;
            if (outcome.status !== 'ok') {
                if (outcome.reason !== 'empty') setNotice(outcome.reason);
                return;
            }
            const confident = outcome.proposal.items.filter(isConfidentInboxSuggestion);
            const unsure = outcome.proposal.items.filter((item) => !isConfidentInboxSuggestion(item));
            remember(unsure);
            if (confident.length === 0) {
                showResult({ sorted: 0, needYou: unsure.length, changeId: null });
                return;
            }
            const applied = await apply(confident, label(confident.length));
            if (!mountedRef.current) return;
            await onChanged();
            showResult({
                sorted: applied.updatedTaskIds.length + applied.deletedTaskIds.length,
                needYou: unsure.length + applied.failed.length,
                changeId: applied.changeId,
            });
        } catch (error) {
            reportError('Failed to sort the Inbox from the menu bar panel', error);
            if (mountedRef.current) setNotice('failed');
        } finally {
            if (mountedRef.current) setPhase('idle');
        }
    }, [apply, generate, label, language, onChanged, phase, remember, showResult]);

    const undoSort = useCallback(async () => {
        const changeId = result?.changeId;
        if (!changeId || phase !== 'idle') return;
        setPhase('undoing');
        try {
            const ok = await undo(changeId);
            await onChanged();
            if (!mountedRef.current) return;
            showResult(null);
            if (!ok) setNotice('undo-failed');
        } catch (error) {
            reportError('Failed to undo the Inbox sort from the menu bar panel', error);
            if (mountedRef.current) setNotice('undo-failed');
        } finally {
            if (mountedRef.current) setPhase('idle');
        }
    }, [onChanged, phase, result, showResult, undo]);

    const dismissNotice = useCallback(() => setNotice(null), []);

    return { phase, result, notice, sort, undoSort, dismissNotice };
}
