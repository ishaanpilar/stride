import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { shouldOfferLooseGrouping, tFallback } from '@stride/core';

import { dismissLooseGrouping, readLooseGroupingDismissedCount } from '../../lib/ai-organise-service';

export type LooseGroupingBannerProps = {
    looseCount: number;
    t: (key: string) => string;
    onGroup: () => void;
};

/** One quiet line above the loose rows; dismissal is remembered per device until 3+ more tasks arrive. */
export function LooseGroupingBanner({ looseCount, t, onGroup }: LooseGroupingBannerProps) {
    const [dismissedAt, setDismissedAt] = useState<number | null>(() => readLooseGroupingDismissedCount());
    if (!shouldOfferLooseGrouping(looseCount, dismissedAt)) return null;
    const dismiss = () => {
        dismissLooseGrouping(looseCount);
        setDismissedAt(looseCount);
    };
    const dismissLabel = tFallback(t, 'common.dismiss', 'Dismiss');
    return (
        <div className="flex items-center gap-2 px-1 text-[13px] text-muted-foreground" data-testid="loose-grouping-banner">
            <button
                type="button"
                onClick={onGroup}
                className="focus-ring inline-flex min-h-6 items-center gap-1.5 rounded-control px-1 font-medium text-accent-text transition-colors hover:bg-accent-soft"
            >
                <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {tFallback(t, 'aiOrganise.groupThese', 'Group these')}
            </button>
            <button
                type="button"
                onClick={dismiss}
                aria-label={dismissLabel}
                title={dismissLabel}
                className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded-control text-tertiary transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
        </div>
    );
}
