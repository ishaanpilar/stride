import { Brain } from 'lucide-react';
import { tFallback } from '@stride/core';
import { openQuickCapture } from '../lib/quick-capture-service';

type Props = { t: (key: string) => string; variant?: 'primary' | 'secondary' };

/** Opens the Quick Capture (AI mind sweep) dialog. */
export function QuickCaptureTrigger({ t, variant = 'primary' }: Props) {
    const className = variant === 'primary'
        ? 'flex items-center justify-center gap-2 whitespace-nowrap bg-primary px-4 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90 rounded-lg'
        : 'flex items-center justify-center gap-2 whitespace-nowrap border border-border text-muted-foreground px-3 rounded-lg text-sm font-medium hover:bg-accent hover:text-foreground transition-colors';
    return (
        <button type="button" onClick={openQuickCapture} className={className} data-quick-capture-trigger>
            <Brain className="w-4 h-4" />
            {tFallback(t, 'quickCapture.button', 'Capture')}
        </button>
    );
}
