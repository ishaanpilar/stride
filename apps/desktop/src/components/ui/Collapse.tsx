import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { usePresence } from '../../hooks/usePresence';
import { MOTION_DURATION } from '../../lib/motion';

type CollapseProps = {
    open: boolean;
    children: ReactNode;
    id?: string;
    className?: string;
    innerClassName?: string;
    unmountWhenClosed?: boolean;
};

export function Collapse({ open, children, id, className, innerClassName, unmountWhenClosed = false }: CollapseProps) {
    const { state, mounted } = usePresence(open, MOTION_DURATION.collapse);
    const closed = state === 'closed';
    return (
        <div
            id={id}
            hidden={closed}
            data-state={state}
            className={cn('motion-collapse', closed && 'hidden', className)}
            aria-hidden={!closed && !open ? true : undefined}
            inert={!closed && !open ? true : undefined}
        >
            <div className={cn('motion-collapse__inner', innerClassName)}>
                {unmountWhenClosed && !mounted ? null : children}
            </div>
        </div>
    );
}
