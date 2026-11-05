import { useLayoutEffect, useRef } from 'react';

import { EXIT_GHOST_PRESETS, playExitGhost, type ExitGhostPresetName } from '../../lib/exit-ghost';

type ExitGhostProps = {
    preset?: ExitGhostPresetName;
};

export function ExitGhost({ preset = 'popover' }: ExitGhostProps) {
    const anchorRef = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        const surface = anchorRef.current?.parentElement ?? null;
        return () => playExitGhost(surface, EXIT_GHOST_PRESETS[preset]);
    }, [preset]);
    return <span ref={anchorRef} hidden data-exit-ghost-anchor="" />;
}
