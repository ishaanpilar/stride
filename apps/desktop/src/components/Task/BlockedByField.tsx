import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Lock, X } from 'lucide-react';
import {
    createTaskLookup,
    formatDependencyRefusal,
    getBlockerCandidates,
    getBlockers,
    isBlockerOpen,
    normalizeBlockedByTaskIds,
    tFallback,
    type BlockerCandidate,
    type Task,
    useTaskStore,
} from '@stride/core';
import { Pill } from '../ui/Pill';
import { TaskEditorFieldLabel } from './task-editor-label';

const CANDIDATE_LIMIT = 6;

type BlockedByFieldProps = {
    task: Task;
    t: (key: string) => string;
    autoFocus?: boolean;
    hideLabel?: boolean;
};

const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input, [role="option"]'));
    const index = controls.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = controls[(index + step + controls.length) % controls.length];
    event.preventDefault();
    next?.focus();
};

export function BlockedByField({ task, t, autoFocus = false, hideLabel = false }: BlockedByFieldProps) {
    const tasks = useTaskStore((state) => state._allTasks);
    const updateTask = useTaskStore((state) => state.updateTask);
    const lookup = useMemo(() => createTaskLookup(tasks), [tasks]);
    const [query, setQuery] = useState('');
    const [listOpen, setListOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const current = lookup.get(task.id) ?? task;
    const blockers = getBlockers(current, lookup);
    const candidates = useMemo(
        () => (listOpen || query
            ? getBlockerCandidates({ task: current, tasks, lookup, query, limit: CANDIDATE_LIMIT })
            : []),
        [current, listOpen, lookup, query, tasks],
    );
    const label = tFallback(t, 'dependencies.blockedBy', 'Blocked by');
    const searchLabel = tFallback(t, 'dependencies.searchPlaceholder', 'Search tasks');
    const noMatchesLabel = tFallback(t, 'common.noMatches', 'No matches');
    const hint = tFallback(t, 'dependencies.fieldHint', 'This task stays out of Focus until these are done.');
    const removeLabel = tFallback(t, 'dependencies.remove', 'Remove blocker');

    const save = async (ids: readonly string[]) => {
        const result = await updateTask(task.id, { blockedByTaskIds: normalizeBlockedByTaskIds(ids, task.id) });
        if (!result.success) setError(result.error ?? tFallback(t, 'dependencies.refusedMissing', 'That task no longer exists.'));
    };
    const addBlocker = (candidate: BlockerCandidate) => {
        if (candidate.refusal) {
            setError(formatDependencyRefusal({ ok: false, reason: candidate.refusal }, t));
            return;
        }
        setError(null);
        setQuery('');
        void save([...(current.blockedByTaskIds ?? []), candidate.task.id]);
    };
    const removeBlocker = (blockerId: string) => {
        setError(null);
        void save((current.blockedByTaskIds ?? []).filter((id) => id !== blockerId));
    };

    return (
        <div className="space-y-2" data-testid="blocked-by-field" onKeyDown={moveFocus}>
            {hideLabel ? null : <TaskEditorFieldLabel icon={Lock}>{label}</TaskEditorFieldLabel>}
            {blockers.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5" aria-label={label}>
                    {blockers.map((blocker) => (
                        <Pill key={blocker.id} tone={isBlockerOpen(blocker) ? 'neutral' : 'success'} className="bg-well">
                            <span className="truncate">{blocker.title}</span>
                            <button
                                type="button"
                                className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-accent focus-ring"
                                aria-label={`${removeLabel}: ${blocker.title}`}
                                onClick={() => removeBlocker(blocker.id)}
                            >
                                <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                        </Pill>
                    ))}
                </div>
            ) : null}
            <input
                autoFocus={autoFocus}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setError(null); }}
                onFocus={() => setListOpen(true)}
                placeholder={searchLabel}
                aria-label={searchLabel}
                className="w-full rounded-control bg-well px-3 py-1.5 text-sm text-foreground focus-ring"
                data-testid="blocked-by-search"
            />
            {listOpen ? (
                <div role="listbox" aria-label={label} className="max-h-52 space-y-0.5 overflow-y-auto">
                    {candidates.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-muted-foreground">{noMatchesLabel}</p>
                    ) : candidates.map((candidate) => (
                        <button
                            key={candidate.task.id}
                            type="button"
                            role="option"
                            aria-selected={false}
                            className="flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-sm text-foreground hover:bg-accent focus-ring"
                            onClick={() => addBlocker(candidate)}
                            data-testid={`blocked-by-option-${candidate.task.id}`}
                        >
                            <span className="min-w-0 flex-1 truncate">{candidate.task.title}</span>
                            {candidate.refusal ? <Lock className="h-3.5 w-3.5 shrink-0 text-tertiary" aria-hidden="true" /> : null}
                        </button>
                    ))}
                </div>
            ) : null}
            {error ? (
                <p role="alert" className="text-xs text-danger-text" data-testid="blocked-by-error">{error}</p>
            ) : (
                <p className="text-xs text-muted-foreground">{hint}</p>
            )}
        </div>
    );
}
