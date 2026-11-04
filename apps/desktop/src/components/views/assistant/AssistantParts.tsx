import { Check, Undo2, X } from 'lucide-react';
import type { ChangeEntry, PendingConfirmation } from '@stride/core';
import { Button } from '../../ui/Button';

export function ChangeChip({ entry, onUndo }: { entry: ChangeEntry; onUndo: (id: string) => void }) {
    return (
        <div
            className={`inline-flex max-w-full items-center gap-2 rounded-pill bg-card shadow-soft-sm px-3 py-1 text-xs ${entry.undone ? 'opacity-60' : ''}`}
            data-testid="assistant-change-chip"
        >
            <Check className="h-3 w-3 shrink-0 text-accent-text" aria-hidden />
            <span className={`truncate ${entry.undone ? 'line-through' : ''}`}>{entry.label}</span>
            {entry.undone ? (
                <span className="shrink-0 text-muted-foreground">Undone</span>
            ) : (
                <button
                    type="button"
                    onClick={() => onUndo(entry.id)}
                    className="inline-flex shrink-0 items-center gap-1 font-medium text-accent-text hover:underline focus-ring rounded-sm"
                >
                    <Undo2 className="h-3 w-3" aria-hidden />
                    Undo
                </button>
            )}
        </div>
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
    return (
        <div className="soft-surface rounded-card p-4 text-sm ring-1 ring-warning-fill/40" data-testid="assistant-confirm-card">
            <div className="font-medium">{pending.summary}</div>
            <div className="text-xs text-muted-foreground">{pending.reason}. Nothing changes until you confirm.</div>
            {shown.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
                    {shown.map((t) => <li key={t.id} className="truncate">{t.title}</li>)}
                    {pending.affected.length > shown.length && <li>and {pending.affected.length - shown.length} more</li>}
                </ul>
            )}
            {pending.status === 'pending' ? (
                <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => onConfirm(pending.id)}>Confirm</Button>
                    <Button size="sm" variant="secondary" leadingIcon={<X className="h-3 w-3" />} onClick={() => onReject(pending.id)}>Decline</Button>
                </div>
            ) : (
                <div className="mt-2 text-xs text-muted-foreground">{pending.status === 'confirmed' ? 'Confirmed' : 'Declined'}</div>
            )}
        </div>
    );
}
