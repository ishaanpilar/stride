import { Folder, Loader2, MapPin, Plus, Sparkles, Undo2, X } from 'lucide-react';
import { formatTimeEstimateLabel, safeFormatDate, tFallback, type TaskFillProposal } from '@stride/core';
import { cn } from '../../lib/utils';
import type { TaskFillAi } from './useTaskFillAi';

type Translate = (key: string) => string;

const fieldLabel = (t: Translate, proposal: TaskFillProposal): string => {
    switch (proposal.field) {
        case 'destination': return tFallback(t, 'task.destination', 'Destination');
        case 'contexts': return tFallback(t, 'taskEdit.contextsLabel', 'Contexts');
        case 'tags': return tFallback(t, 'taskEdit.tagsLabel', 'Tags');
        case 'priority': return tFallback(t, 'taskEdit.priorityLabel', 'Priority');
        case 'timeEstimate': return tFallback(t, 'taskEdit.timeEstimateLabel', 'Time Estimate');
        case 'dueDate': return tFallback(t, 'taskEdit.dueDateLabel', 'Due Date');
        case 'startTime': return tFallback(t, 'taskEdit.startDateLabel', 'Start Date');
        case 'checklist': return tFallback(t, 'taskEdit.checklist', 'Checklist');
        default: return '';
    }
};

const proposalValue = (t: Translate, proposal: TaskFillProposal): string => {
    switch (proposal.field) {
        case 'destination': return proposal.label;
        case 'contexts':
        case 'tags': return proposal.values.join(' ');
        case 'priority': return tFallback(t, `priority.${proposal.value}`, proposal.value);
        case 'timeEstimate': return formatTimeEstimateLabel(proposal.value);
        case 'dueDate':
        case 'startTime': return safeFormatDate(proposal.value, 'PP', proposal.value);
        case 'checklist': return proposal.values.join(' · ');
        default: return '';
    }
};

export function TaskFillAiButton({ fill, t, className }: { fill: TaskFillAi; t: Translate; className?: string }) {
    if (!fill.available) return null;
    const label = tFallback(t, 'taskEdit.fillWithAi', 'Fill with AI');
    const loading = fill.status === 'loading';
    return (
        <button
            type="button"
            onClick={() => void fill.run()}
            disabled={loading}
            aria-busy={loading}
            data-task-fill-ai
            className={cn(
                'focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-text transition-colors hover:brightness-95 disabled:opacity-70 motion-reduce:transition-none',
                className,
            )}
        >
            {loading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            {label}
        </button>
    );
}

export function TaskFillAiProposals({ fill, t }: { fill: TaskFillAi; t: Translate }) {
    if (!fill.available || (!fill.hasResult && !fill.canUndo)) return null;
    const title = tFallback(t, 'taskEdit.fillWithAi', 'Fill with AI');
    const applyAllLabel = tFallback(t, 'copilot.applyAll', 'Apply all');
    const undoLabel = tFallback(t, 'common.undo', 'Undo');
    const dismissLabel = tFallback(t, 'common.dismiss', 'Dismiss');
    const empty = fill.status === 'ready' && fill.proposals.length === 0 && !fill.canUndo;
    return (
        <section
            aria-label={tFallback(t, 'taskEdit.fillWithAi', 'Fill with AI')}
            data-task-fill-ai-proposals
            className="motion-expand-in space-y-1.5 rounded-control bg-well p-2 text-xs"
        >
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    {title}
                </span>
                {fill.source === 'fallback' && fill.proposals.length > 0 && (
                    <span>{tFallback(t, 'taskEdit.fillWithAiFallback', 'AI unavailable. Showing basic suggestions.')}</span>
                )}
                <span className="ml-auto inline-flex items-center gap-1">
                    {fill.proposals.length > 1 && (
                        <button
                            type="button"
                            onClick={fill.applyAll}
                            className="focus-ring rounded-control px-1.5 py-0.5 font-medium text-accent-text hover:bg-accent-soft"
                        >
                            {applyAllLabel}
                        </button>
                    )}
                    {fill.canUndo && (
                        <button
                            type="button"
                            onClick={fill.undo}
                            className="focus-ring inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-foreground hover:bg-muted/60"
                        >
                            <Undo2 className="h-3 w-3" aria-hidden="true" />
                            {undoLabel}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={fill.dismiss}
                        aria-label={dismissLabel}
                        title={dismissLabel}
                        className="focus-ring inline-flex h-5 w-5 items-center justify-center rounded-control hover:bg-muted/60"
                    >
                        <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                </span>
            </div>
            {empty && (
                <p className="text-muted-foreground">
                    {tFallback(t, 'taskEdit.fillWithAiEmpty', 'No suggestions for the empty fields.')}
                </p>
            )}
            {fill.proposals.length > 0 && (
                <ul className="space-y-1">
                    {fill.proposals.map((proposal) => {
                        const label = fieldLabel(t, proposal);
                        const value = proposalValue(t, proposal);
                        return (
                            <li key={proposal.field} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
                                <button
                                    type="button"
                                    onClick={() => fill.apply(proposal)}
                                    aria-label={`${label}: ${value}`}
                                    title={proposal.reason}
                                    data-task-fill-proposal={proposal.field}
                                    className="focus-ring inline-flex max-w-full items-center gap-1 rounded-pill bg-card px-2 py-0.5 text-foreground shadow-soft-sm hover:bg-accent-soft hover:text-accent-text"
                                >
                                    <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
                                    {proposal.field === 'destination' && (proposal.kind === 'project'
                                        ? <Folder className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        : <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />)}
                                    <span className="truncate">{value}</span>
                                </button>
                                {proposal.reason && <span className="min-w-0 text-muted-foreground">{proposal.reason}</span>}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
