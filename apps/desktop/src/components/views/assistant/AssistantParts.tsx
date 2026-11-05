import { CheckCircle2, FolderKanban, GitMerge, Layers, ListChecks, Pencil, Plus, Tag, Trash2, Undo2, X } from 'lucide-react';
import type { ChangeEntry, PendingConfirmation } from '@stride/core';
import { Button } from '../../ui/Button';
import { Pill } from '../../ui/Pill';
import { cn } from '../../../lib/utils';

type ChangeKind = 'created' | 'deleted' | 'updated';

export function changeKind(entry: Pick<ChangeEntry, 'toolName' | 'label'>): ChangeKind {
    const name = entry.toolName ?? '';
    if (/delete/i.test(name) || /^Deleted\b/.test(entry.label)) return 'deleted';
    if (/^add_|create|breakdown/i.test(name) || /^(Added|Created|Broke)\b/.test(entry.label)) return 'created';
    return 'updated';
}

/** Entity kinds (project/area/tag/merge/plan) get their own icon; plain task changes use created/updated/deleted. */
type RowKind = ChangeKind | 'project' | 'area' | 'tag' | 'merge' | 'plan';
export function rowKind(entry: Pick<ChangeEntry, 'toolName' | 'label' | 'kind'>): RowKind {
    if (entry.kind && entry.kind !== 'task') return entry.kind;
    return changeKind(entry);
}

const KIND_ICON: Record<RowKind, typeof Pencil> = { created: Plus, deleted: Trash2, updated: Pencil, project: FolderKanban, area: Layers, tag: Tag, merge: GitMerge, plan: ListChecks };
const KIND_LABEL: Record<RowKind, string> = { created: 'Created', deleted: 'Deleted', updated: 'Updated', project: 'Project', area: 'Area', tag: 'Tags', merge: 'Merged', plan: 'Batch plan' };

/** Compact "Changes" card: one row per action with the full (wrapped) label and its own Undo. */
export function ChangesCard({
    entries,
    onUndo,
    onUndoAll,
}: {
    entries: ChangeEntry[];
    onUndo: (id: string) => void;
    onUndoAll?: () => void;
}) {
    if (entries.length === 0) return null;
    const undoable = entries.filter((e) => !e.undone);
    return (
        <section className="soft-surface w-full max-w-[85%] rounded-card p-3" data-testid="assistant-changes-card" aria-label="Changes">
            <div className="mb-1.5 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success-text" aria-hidden />
                    Changes
                </h3>
                {undoable.length > 1 && onUndoAll && (
                    <Button size="sm" variant="ghost" leadingIcon={<Undo2 className="h-3.5 w-3.5" />} onClick={onUndoAll}>Undo all</Button>
                )}
            </div>
            <ul className="divide-y divide-border/60">
                {entries.map((e) => {
                    const kind = rowKind(e);
                    const Icon = KIND_ICON[kind];
                    return (
                        <li key={e.id} className={cn('flex items-start gap-2.5 py-2 first:pt-0 last:pb-0', e.undone && 'opacity-60')} data-testid="assistant-change-row">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-well text-muted-foreground" title={KIND_LABEL[kind]}>
                                <Icon className="h-3.5 w-3.5" aria-hidden />
                                <span className="sr-only">{KIND_LABEL[kind]}</span>
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className={cn('block text-[13px] leading-5 [overflow-wrap:anywhere]', e.undone && 'line-through')}>{e.label}</span>
                                {e.details && e.details.length > 0 && (
                                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                                        {e.details.map((d, i) => <li key={i}>{d}</li>)}
                                    </ul>
                                )}
                            </span>
                            {e.undone ? (
                                <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">Undone</span>
                            ) : (
                                <Button size="sm" variant="ghost" className="shrink-0" aria-label={`Undo: ${e.label}`} leadingIcon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => onUndo(e.id)}>
                                    Undo
                                </Button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

export function ConfirmCard({
    pending,
    onConfirm,
    onReject,
}: {
    pending: PendingConfirmation;
    onConfirm: (id: string) => void;
    onReject: (id: string) => void;
}) {
    const shown = pending.affected.slice(0, 6);
    const isPending = pending.status === 'pending';
    return (
        <section className="soft-surface w-full max-w-[85%] rounded-card p-3.5 text-sm ring-1 ring-warning-fill/40" data-testid="assistant-confirm-card" aria-label="Needs your confirmation">
            <Pill tone={isPending ? 'warning' : pending.status === 'confirmed' ? 'success' : 'neutral'}>
                {isPending ? 'Needs your confirmation' : pending.status === 'confirmed' ? 'Confirmed' : 'Declined'}
            </Pill>
            <div className="mt-2 whitespace-pre-line font-semibold leading-5 [overflow-wrap:anywhere]">{pending.summary}</div>
            <div className="text-xs text-muted-foreground">{pending.reason}. Nothing changes until you confirm.</div>
            {shown.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] [overflow-wrap:anywhere]">
                    {shown.map((t) => <li key={t.id}>{t.title}</li>)}
                    {pending.affected.length > shown.length && <li>and {pending.affected.length - shown.length} more</li>}
                </ul>
            )}
            {isPending && (
                <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => onConfirm(pending.id)}>Confirm</Button>
                    <Button size="sm" variant="secondary" leadingIcon={<X className="h-3 w-3" />} onClick={() => onReject(pending.id)}>Decline</Button>
                </div>
            )}
        </section>
    );
}

export const STARTER_SUGGESTIONS = ['Plan my day', "What's overdue?", 'Triage my inbox', 'Find duplicates'];
export const FALLBACK_SUGGESTIONS = ['Plan my day', "What's overdue?", 'Find duplicates'];

export function SuggestionChips({ suggestions, onPick, disabled }: { suggestions: string[]; onPick: (text: string) => void; disabled?: boolean }) {
    if (suggestions.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggested replies" data-testid="assistant-suggestions">
            {suggestions.map((s) => (
                <button
                    key={s}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPick(s)}
                    className="focus-ring inline-flex min-h-[28px] max-w-full items-center rounded-pill bg-card px-3 py-1 text-left text-xs font-medium text-accent-text shadow-soft-sm transition-colors hover:bg-accent-soft disabled:opacity-50"
                >
                    {s}
                </button>
            ))}
        </div>
    );
}
