import { Brain } from 'lucide-react';
import { tFallback } from '@stride/core';
import { openQuickCapture } from '../lib/quick-capture-service';
import { Button } from './ui/Button';

type Props = { t: (key: string) => string; variant?: 'primary' | 'secondary' };

/** Opens the Quick Capture (AI mind sweep) dialog. */
export function QuickCaptureTrigger({ t, variant = 'primary' }: Props) {
    return (
        <Button
            variant={variant}
            size={variant === 'primary' ? 'lg' : 'md'}
            onClick={openQuickCapture}
            data-quick-capture-trigger
            leadingIcon={<Brain className="w-4 h-4" aria-hidden="true" />}
        >
            {tFallback(t, 'quickCapture.button', 'Capture')}
        </Button>
    );
}
