import type { QuickAddPreviewEntry } from '@stride/core';

import { cn } from '../lib/utils';


const MAX_VISIBLE_ENTRIES = 8;

type QuickAddPreviewProps = {
    entries: QuickAddPreviewEntry[];
    className?: string;
};


export function QuickAddPreview({ entries, className }: QuickAddPreviewProps) {
    const visible = entries.slice(0, MAX_VISIBLE_ENTRIES);
    const overflow = entries.length - visible.length;


    return (
        <div
            role="status"
            aria-live="polite"
            data-testid="quick-add-preview"
            className={cn('flex flex-wrap items-center gap-1 text-xs leading-4', className)}
        >
            {visible.map((entry) => (
                <span
                    key={entry.id}


                    aria-hidden={entry.kind === 'title' ? true : undefined}
                    className={cn(
                        'inline-flex h-[26px] max-w-full items-center gap-1 rounded-pill px-2.5',
                        entry.tone === 'warning'
                            ? 'bg-destructive/10 text-danger-text'
                            : 'bg-well text-muted-foreground',
                    )}
                >
                    {entry.label ? <span className="shrink-0">{entry.label}</span> : null}
                    <span className={cn('truncate font-medium', entry.tone === 'warning' ? '' : 'text-foreground/80')}>
                        {entry.value}
                    </span>
                </span>
            ))}
            {overflow > 0 ? (
                <span className="inline-flex h-[26px] items-center rounded-pill bg-well px-2.5 text-muted-foreground">
                    +{overflow}
                </span>
            ) : null}
        </div>
    );
}
