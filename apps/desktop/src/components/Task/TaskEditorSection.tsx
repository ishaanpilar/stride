import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '../../lib/utils';

interface TaskEditorSectionProps {
    title: string;
    count: number;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
}

export function TaskEditorSection({ title, count, open, onToggle, children }: TaskEditorSectionProps) {
    const contentId = useId();
    const sectionRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLButtonElement>(null);
    const revealOnOpen = useRef(false);

    useEffect(() => {
        if (!open || !revealOnOpen.current) return;
        const frame = requestAnimationFrame(() => {
            revealOnOpen.current = false;
            const section = sectionRef.current;
            if (!section) return;


            let availableHeight = window.innerHeight;
            for (let parent = section.parentElement; parent; parent = parent.parentElement) {
                if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
                    availableHeight = Math.min(availableHeight, parent.clientHeight);
                }
            }
            if (section.getBoundingClientRect().height <= availableHeight) {
                section.scrollIntoView({ block: 'nearest', behavior: 'instant' });
            } else {


                headerRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [open]);

    return (
        <div ref={sectionRef} className="border-t border-border/60">
            <button
                ref={headerRef}
                type="button"
                onClick={() => {
                    revealOnOpen.current = !open;
                    onToggle();
                }}
                className="focus-ring-inset w-full flex items-center justify-between py-3 text-[13px] text-muted-foreground font-semibold hover:text-foreground"
                aria-expanded={open}
                aria-controls={contentId}
            >
                <span className="flex items-center gap-2">
                    {title}
                    {count > 0 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent-soft text-accent-text">{count}</span>
                    )}
                </span>
                <ChevronRight className={cn('motion-chevron h-3.5 w-3.5 shrink-0', open && 'rotate-90')} aria-hidden="true" />
            </button>
            <div id={contentId} hidden={!open} className={cn('pb-3 space-y-3', open && 'motion-expand-in')}>{open && children}</div>
        </div>
    );
}
