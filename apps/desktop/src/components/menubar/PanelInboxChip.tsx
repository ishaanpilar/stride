import { Loader2, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { PanelSortNotice, PanelSortPhase, PanelSortResult } from './usePanelInboxSort';

type Text = (key: string, fallback: string) => string;
const fill = (text: string, count: number) => text.replace('{{count}}', String(count));

export interface PanelInboxChipProps {
    /** Live Inbox items. The chip shows only when there are some. */
    count: number;
    /** AI is on: offer ✨ Sort. */
    canSort: boolean;
    phase: PanelSortPhase;
    result: PanelSortResult | null;
    notice: PanelSortNotice;
    tr: Text;
    onSort: () => void;
    onUndo: () => void;
    onReview: () => void;
    onDismissNotice: () => void;
}

const linkClass = 'rounded-sm font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-ring';

/**
 * Under the note box: "3 notes in Inbox · Review in Stride · ✨ Sort". Sort applies only the confident
 * suggestions in place (one undoable batch) and reports "Sorted N · Undo" and "M need you".
 */
export function PanelInboxChip({ count, canSort, phase, result, notice, tr, onSort, onUndo, onReview, onDismissNotice }: PanelInboxChipProps) {
    const busy = phase !== 'idle';
    const noticeText = notice === 'disabled'
        ? tr('menubar.sortDisabled', 'Set up AI in Settings → AI to sort here.')
        : notice === 'limited'
            ? tr('menubar.sortLimited', 'AI limit reached for now. Try again later.')
            : notice === 'undo-failed'
                ? tr('inboxHub.undoFailed', 'Couldn’t undo everything. Check the Inbox.')
                : notice === 'failed'
                    ? tr('menubar.sortFailed', 'Couldn’t sort right now. Nothing changed.')
                    : null;
    return (
        <>
            {count > 0 && (
                <div className="mt-2 flex min-h-7 items-center justify-between gap-2 pl-1 text-[13px] text-muted-foreground" data-testid="menubar-inbox-chip">
                    <span className="min-w-0 truncate tabular-nums">
                        {count === 1
                            ? tr('menubar.inboxOne', '1 note in Inbox')
                            : fill(tr('menubar.inboxMany', '{{count}} notes in Inbox'), count)}
                    </span>
                    <span className="flex shrink-0 items-center gap-2.5">
                        <button type="button" onClick={onReview} className={linkClass} data-testid="menubar-inbox-review">
                            {tr('menubar.reviewInStride', 'Review in Stride')}
                        </button>
                        {canSort && (
                            <button
                                type="button"
                                onClick={onSort}
                                disabled={busy}
                                aria-busy={phase === 'sorting'}
                                title={tr('menubar.sortHint', 'Sort the clear ones with AI; unsure ones stay in the Inbox')}
                                data-testid="menubar-inbox-sort"
                                className="motion-press inline-flex h-7 items-center gap-1.5 rounded-pill bg-accent-soft px-2.5 text-[12px] font-semibold text-accent-text transition-[background-color,scale] duration-200 ease-out hover:shadow-soft-sm disabled:opacity-70 motion-reduce:transition-none focus-ring"
                            >
                                {phase === 'sorting'
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                    : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
                                {phase === 'sorting' ? tr('menubar.sorting', 'Sorting…') : tr('menubar.sort', 'Sort')}
                            </button>
                        )}
                    </span>
                </div>
            )}
            {result && (
                <div
                    role="status"
                    data-testid="menubar-sort-result"
                    className="pomo-in mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-control bg-well px-2.5 py-1.5 text-[13px] text-foreground shadow-soft-inset"
                >
                    {result.sorted > 0 ? (
                        <span className="inline-flex items-center gap-2">
                            <span>{fill(tr('menubar.sorted', 'Sorted {{count}}'), result.sorted)}</span>
                            {result.changeId && (
                                <button type="button" onClick={onUndo} disabled={busy} className={cn(linkClass, 'font-semibold text-foreground')} data-testid="menubar-sort-undo">
                                    {tr('common.undo', 'Undo')}
                                </button>
                            )}
                        </span>
                    ) : (
                        <span className="text-muted-foreground">{tr('menubar.sortedNone', 'Nothing clear enough to sort.')}</span>
                    )}
                    {result.needYou > 0 && (
                        <span className="inline-flex items-center gap-2 text-muted-foreground">
                            <span aria-hidden>·</span>
                            <span>{fill(tr('menubar.needYou', '{{count}} need you'), result.needYou)}</span>
                            <button type="button" onClick={onReview} className={linkClass}>
                                {tr('menubar.reviewInStride', 'Review in Stride')}
                            </button>
                        </span>
                    )}
                </div>
            )}
            {noticeText && (
                <p role="alert" className="mt-1.5 flex items-center gap-2 pl-1 text-[13px] text-warning-text" data-testid="menubar-sort-notice">
                    <span className="min-w-0 flex-1">{noticeText}</span>
                    <button type="button" onClick={onDismissNotice} className={linkClass}>{tr('common.dismiss', 'Dismiss')}</button>
                </p>
            )}
        </>
    );
}
