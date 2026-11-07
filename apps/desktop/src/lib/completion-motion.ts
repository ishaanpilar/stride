import { useLayoutEffect, useRef, type RefObject } from 'react';

import { COMPLETION_LEAVE_MS, completionLeavesView, type CompletionPhase } from './completion-sequence';
import { MOTION_EASING, canAnimate } from './motion';

/**
 * Leaving and settling for a completing row (the CSS in styles/motion.css does the click, strike and
 * flash). On 'leaving' the row collapses its height and fades/slides down while the rows below rise
 * into its place; on 'gone', if the row is still on screen (the view keeps done tasks at the bottom),
 * the collapse is undone and the row fades in at its new place.
 */

/** Marks the element that collapses (instead of the row itself), e.g. a virtualised list's row wrapper. */
export const COMPLETION_COLLAPSE_ATTR = 'data-completion-collapse';

function isLayoutContainer(element: HTMLElement): boolean {
    const display = getComputedStyle(element).display;
    return display.includes('flex') || display.includes('grid');
}

/** The element whose box takes the row's place in the list: the row, or a single-child wrapper around it. */
export function findCollapseTarget(row: HTMLElement): HTMLElement {
    const marked = row.closest<HTMLElement>(`[${COMPLETION_COLLAPSE_ATTR}]`);
    if (marked) return marked;
    let target = row;
    for (let depth = 0; depth < 4; depth += 1) {
        const parent = target.parentElement;
        if (!parent || isLayoutContainer(parent) || parent.children.length !== 1) break;
        if (parent.tagName === 'UL' || parent.tagName === 'OL' || parent.tagName === 'SECTION') break;
        target = parent;
    }
    return target;
}

function px(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

type Collapse = { target: HTMLElement; animations: Animation[]; restore: () => void };

export function playCompletionCollapse(row: HTMLElement, duration: number = COMPLETION_LEAVE_MS): Collapse | null {
    if (!canAnimate()) return null;
    const target = findCollapseTarget(row);
    const style = getComputedStyle(target);
    const height = target.getBoundingClientRect().height;
    if (height <= 0) return null;
    const parent = target.parentElement;
    const gap = parent && isLayoutContainer(parent) ? px(getComputedStyle(parent).rowGap) : 0;
    const marginTop = px(style.marginTop);
    const marginBottom = px(style.marginBottom);
    // Swallow the gap too, so the rows below end exactly where they will be once the row is gone.
    const endMarginBottom = target.nextElementSibling ? -gap : 0;
    const endMarginTop = !target.nextElementSibling && target.previousElementSibling ? -gap : 0;
    const previousOverflow = target.style.overflow;
    target.style.overflow = 'hidden';
    const timing: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' };
    const animations = [
        target.animate([
            { height: `${height}px`, marginTop: `${marginTop}px`, marginBottom: `${marginBottom}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom },
            { height: '0px', marginTop: `${endMarginTop}px`, marginBottom: `${endMarginBottom}px`, paddingTop: '0px', paddingBottom: '0px' },
        ], timing),
        row.animate([
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateY(10px) scale(0.98)' },
        ], { duration: duration * 0.6, easing: MOTION_EASING.out, fill: 'forwards' }),
    ];
    return {
        target,
        animations,
        restore: () => {
            animations.forEach((animation) => animation.cancel());
            target.style.overflow = previousOverflow;
        },
    };
}

const SETTLE_IN: Keyframe[] = [
    { opacity: 0, transform: 'translateY(-6px)' },
    { opacity: 1, transform: 'none' },
];

/**
 * Drives the leaving collapse and the settle-in for one row. `phase` comes from useCompletionPhase.
 * Also tags the row so an exit ghost is not played for a row that already collapsed.
 */
export function useCompletionRowMotion(ref: RefObject<HTMLElement | null>, phase: CompletionPhase | undefined, taskId?: string): void {
    const collapseRef = useRef<Collapse | null>(null);
    useLayoutEffect(() => {
        const row = ref.current;
        if (!row) return;
        if (phase === 'leaving') {
            // Already the last row: it is where done rows go, so it simply stays (and, if the view drops
            // it instead, the regular row exit plays).
            if (!collapseRef.current && findCollapseTarget(row).nextElementSibling) {
                collapseRef.current = playCompletionCollapse(row);
                if (collapseRef.current) row.setAttribute('data-exit-ghost-skip', '');
            }
            return;
        }
        // A repeating task's done copy is on its way out of the view: nothing to settle into.
        if (phase === 'gone' && taskId && completionLeavesView(taskId)) return;
        const collapse = collapseRef.current;
        collapseRef.current = null;
        if (phase !== 'gone') row.removeAttribute('data-exit-ghost-skip');
        if (!collapse) return;
        collapse.restore();
        // Gone and still rendered: it moved to the done-at-bottom place. Undo/cancel: just come back.
        if (canAnimate()) row.animate(SETTLE_IN, { duration: 280, easing: MOTION_EASING.out });
    }, [phase, ref, taskId]);
    useLayoutEffect(() => () => {
        collapseRef.current?.restore();
        collapseRef.current = null;
    }, []);
}
