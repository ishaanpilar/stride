import { useLayoutEffect, type RefObject } from 'react';

import { MOTION_DURATION, MOTION_EASING, canAnimate } from './motion';

export type ExitGhostPart = {
    selector: string;
    keyframes: Keyframe[];
    duration?: number;
    easing?: string;
};

export type ExitGhostPreset = {
    keyframes: Keyframe[];
    duration: number;
    easing: string;
    layout?: 'in-place' | 'overlay' | 'collapse';
    parts?: ExitGhostPart[];
};

const fadeOut: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];

export const EXIT_GHOST_PRESETS = {
    dialog: {
        keyframes: fadeOut,
        duration: 180,
        easing: MOTION_EASING.exit,
        parts: [{
            selector: '[role="dialog"], [role="alertdialog"]',
            keyframes: [
                { opacity: 1, transform: 'none' },
                { opacity: 0, transform: 'translateY(8px) scale(0.95)' },
            ],
            duration: MOTION_DURATION.exit,
        }],
    },
    popover: {
        keyframes: [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateY(-4px) scale(0.96)' },
        ],
        duration: 160,
        easing: MOTION_EASING.exit,
    },
    toast: {
        keyframes: [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateX(16px) scale(0.98)' },
        ],
        duration: 200,
        easing: MOTION_EASING.exit,
        layout: 'collapse',
    },
    toastStack: {
        keyframes: [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateX(16px)' },
        ],
        duration: 200,
        easing: MOTION_EASING.exit,
    },
    sheetRight: {
        keyframes: fadeOut,
        duration: 220,
        easing: MOTION_EASING.exit,
        parts: [{
            selector: '[data-exit-sheet]',
            keyframes: [{ transform: 'none' }, { transform: 'translateX(100%)' }],
            duration: 220,
            easing: MOTION_EASING.out,
        }],
    },
    row: {
        keyframes: [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateX(12px) scale(0.97)' },
        ],
        duration: MOTION_DURATION.list,
        easing: MOTION_EASING.exit,
        layout: 'overlay',
    },
} satisfies Record<string, ExitGhostPreset>;

export type ExitGhostPresetName = keyof typeof EXIT_GHOST_PRESETS;

type ScrollOffset = { index: number; top: number; left: number };

function collectScrollOffsets(root: HTMLElement): ScrollOffset[] {
    const offsets: ScrollOffset[] = [];
    root.querySelectorAll<HTMLElement>('*').forEach((element, index) => {
        if (element.scrollTop || element.scrollLeft) {
            offsets.push({ index, top: element.scrollTop, left: element.scrollLeft });
        }
    });
    return offsets;
}

function restoreScrollOffsets(root: HTMLElement, offsets: ScrollOffset[]): void {
    if (offsets.length === 0) return;
    const elements = root.querySelectorAll<HTMLElement>('*');
    offsets.forEach(({ index, top, left }) => {
        const element = elements[index];
        if (!element) return;
        element.scrollTop = top;
        element.scrollLeft = left;
    });
}

function makeInert(clone: HTMLElement): void {
    clone.setAttribute('inert', '');
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('data-exit-ghost', '');
    clone.removeAttribute('id');
    clone.style.pointerEvents = 'none';
    clone.style.animation = 'none';
    clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
    clone.querySelectorAll('[name]').forEach((element) => element.removeAttribute('name'));
    clone.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((element) => {
        element.removeAttribute('role');
        element.removeAttribute('aria-modal');
    });
}

function insertAtOldPosition(parent: Node, previous: Node | null, clone: HTMLElement): void {
    const anchor = previous && previous.parentNode === parent ? previous.nextSibling : parent.firstChild;
    parent.insertBefore(clone, anchor);
}

const GHOSTS_PER_TICK = 8;
let ghostsThisTick = 0;

function reserveGhostSlot(): boolean {
    if (ghostsThisTick === 0) queueMicrotask(() => { ghostsThisTick = 0; });
    if (ghostsThisTick >= GHOSTS_PER_TICK) return false;
    ghostsThisTick += 1;
    return true;
}

type GhostBox = { top: number; left: number; width: number; height: number };

function placeAsOverlay(clone: HTMLElement, box: GhostBox): void {
    Object.assign(clone.style, {
        position: 'absolute',
        top: `${box.top}px`,
        left: `${box.left}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        margin: '0',
        zIndex: '0',
    });
}

function collapseKeyframes(height: number): Keyframe[] {
    return [
        { height: `${height}px` },
        { height: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' },
    ];
}

export function playExitGhost(node: HTMLElement | null, preset: ExitGhostPreset): void {
    if (!node || !node.isConnected || !canAnimate()) return;
    const parent = node.parentNode;
    if (!parent || !reserveGhostSlot()) return;
    const previous = node.previousSibling;
    const box: GhostBox | null = preset.layout === 'overlay' || preset.layout === 'collapse'
        ? { top: node.offsetTop, left: node.offsetLeft, width: node.offsetWidth, height: node.offsetHeight }
        : null;
    const clone = node.cloneNode(true) as HTMLElement;
    const scrollOffsets = collectScrollOffsets(node);
    const partElements = (preset.parts ?? []).map((part) => ({
        part,
        element: clone.querySelector<HTMLElement>(part.selector),
    }));

    queueMicrotask(() => {
        if (node.isConnected || !parent.isConnected) return;
        makeInert(clone);
        if (box && preset.layout === 'overlay') placeAsOverlay(clone, box);
        insertAtOldPosition(parent, previous, clone);
        restoreScrollOffsets(clone, scrollOffsets);

        const timing = { duration: preset.duration, easing: preset.easing, fill: 'forwards' as const };
        const animations: Animation[] = [clone.animate(preset.keyframes, timing)];
        if (box && preset.layout === 'collapse') {
            clone.style.overflow = 'hidden';
            clone.style.boxSizing = 'border-box';
            animations.push(clone.animate(collapseKeyframes(box.height), timing));
        }
        partElements.forEach(({ part, element }) => {
            if (!element) return;
            element.style.animation = 'none';
            animations.push(element.animate(part.keyframes, {
                duration: part.duration ?? preset.duration,
                easing: part.easing ?? preset.easing,
                fill: 'forwards',
            }));
        });

        const longest = Math.max(preset.duration, ...(preset.parts ?? []).map((part) => part.duration ?? 0));
        let removed = false;
        const remove = () => {
            if (removed) return;
            removed = true;
            clone.remove();
        };
        Promise.all(animations.map((animation) => animation.finished)).then(remove, remove);
        window.setTimeout(remove, longest + 120);
    });
}

export function useExitGhost(
    ref: RefObject<HTMLElement | null>,
    preset: ExitGhostPresetName | ExitGhostPreset,
    enabled = true,
): void {
    useLayoutEffect(() => {
        if (!enabled) return undefined;
        const node = ref.current;
        const resolved = typeof preset === 'string' ? EXIT_GHOST_PRESETS[preset] : preset;
        return () => playExitGhost(node, resolved);
    }, [enabled, preset, ref]);
}
