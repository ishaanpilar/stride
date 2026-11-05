import { useEffect, useState } from 'react';

import { MOTION_DURATION, canAnimate } from '../lib/motion';

export type PresenceState = 'closed' | 'entering' | 'opening' | 'open' | 'closing';

export type Presence = {
    state: PresenceState;
    mounted: boolean;
    visible: boolean;
};

const SETTLE_SLACK_MS = 30;

export function usePresence(open: boolean, durationMs: number = MOTION_DURATION.base): Presence {
    const [state, setState] = useState<PresenceState>(open ? 'open' : 'closed');
    const [previousOpen, setPreviousOpen] = useState(open);

    if (previousOpen !== open) {
        setPreviousOpen(open);
        const animate = canAnimate();
        if (open) setState(animate ? 'entering' : 'open');
        else setState(animate && state !== 'closed' ? 'closing' : 'closed');
    }

    useEffect(() => {
        if (state === 'entering') {
            let second = 0;
            const first = window.requestAnimationFrame(() => {
                second = window.requestAnimationFrame(() => setState('opening'));
            });
            return () => {
                window.cancelAnimationFrame(first);
                window.cancelAnimationFrame(second);
            };
        }
        if (state === 'opening' || state === 'closing') {
            const next: PresenceState = state === 'opening' ? 'open' : 'closed';
            const timer = window.setTimeout(() => setState(next), durationMs + SETTLE_SLACK_MS);
            return () => window.clearTimeout(timer);
        }
        return undefined;
    }, [durationMs, state]);

    return {
        state,
        mounted: state !== 'closed',
        visible: state === 'opening' || state === 'open',
    };
}
