import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { DropPlacement } from '@stride/core';
import {
    autoScrollDelta,
    computeDropTarget,
    exceedsDragThreshold,
    idsAreEqual,
    resolveDropOrder,
    type DropTarget,
    type RowRect,
} from './panel-reorder';

export type PanelDragState = {
    dragId: string | null;
    targetId: string | null;
    placement: DropPlacement | null;
};

const IDLE: PanelDragState = { dragId: null, targetId: null, placement: null };

export type PanelDragGhost = { title: string; width: number; height: number; top: number; left: number };

type Press = {
    pointerId: number;
    taskId: string;
    groupKey: string;
    siblingIds: readonly string[];
    title: string;
    startX: number;
    startY: number;
    active: boolean;
    target: DropTarget | null;
    row: HTMLElement;
    grabOffsetY: number;
};

export type PanelReorderChange = {
    groupKey: string;
    siblingIds: readonly string[];
    nextIds: string[];
    movedId: string;
};

/** Marker for controls inside a row that must keep their own click/press behaviour. */
export const REORDER_IGNORE_ATTR = 'data-reorder-ignore';

/**
 * Pointer-event drag-to-reorder for the menu bar panel. Native pointer events (not HTML5 drag) because the
 * panel is a small always-on-top popover webview: pointer drags never leave the window, so they cannot blur
 * (and hide) it, and there is no dependency on the OS drag session. A press only becomes a drag after a few
 * pixels of travel, so click, tick and keyboard behaviour on the row are untouched.
 */
export function usePanelReorder({
    listRef,
    onReorder,
}: {
    listRef: RefObject<HTMLElement | null>;
    onReorder: (change: PanelReorderChange) => void;
}) {
    const [state, setState] = useState<PanelDragState>(IDLE);
    const [ghost, setGhost] = useState<PanelDragGhost | null>(null);
    const ghostRef = useRef<HTMLDivElement | null>(null);
    const pressRef = useRef<Press | null>(null);
    const pointerYRef = useRef(0);
    const rafRef = useRef<number | null>(null);
    const suppressClickUntilRef = useRef(0);
    const cleanupRef = useRef<(() => void) | null>(null);
    const onReorderRef = useRef(onReorder);
    onReorderRef.current = onReorder;

    const publish = useCallback((next: PanelDragState) => {
        setState((current) => (
            current.dragId === next.dragId && current.targetId === next.targetId && current.placement === next.placement
                ? current
                : next
        ));
    }, []);

    const moveGhost = useCallback((clientY: number) => {
        const press = pressRef.current;
        const node = ghostRef.current;
        if (!press || !node) return;
        node.style.transform = `translateY(${Math.round(clientY - press.grabOffsetY)}px)`;
    }, []);

    const refreshTarget = useCallback(() => {
        const press = pressRef.current;
        const list = listRef.current;
        if (!press?.active || !list) return;
        const rows: RowRect[] = [];
        list.querySelectorAll<HTMLElement>('[data-reorder-id]').forEach((element) => {
            if (element.getAttribute('data-reorder-group') !== press.groupKey) return;
            const rect = element.getBoundingClientRect();
            rows.push({ id: element.getAttribute('data-reorder-id') as string, top: rect.top, bottom: rect.bottom });
        });
        const target = computeDropTarget(rows, press.taskId, pointerYRef.current);
        press.target = target;
        publish({ dragId: press.taskId, targetId: target?.targetId ?? null, placement: target?.placement ?? null });
    }, [listRef, publish]);

    const stopDrag = useCallback(() => {
        cleanupRef.current?.();
        cleanupRef.current = null;
        if (rafRef.current !== null && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        pressRef.current = null;
        setGhost(null);
        publish(IDLE);
    }, [publish]);

    const scrollLoop = useCallback(() => {
        const press = pressRef.current;
        const list = listRef.current;
        if (!press?.active || !list) {
            rafRef.current = null;
            return;
        }
        const rect = list.getBoundingClientRect();
        const delta = autoScrollDelta(pointerYRef.current, rect);
        if (delta !== 0) {
            const before = list.scrollTop;
            list.scrollTop = before + delta;
            if (list.scrollTop !== before) refreshTarget();
        }
        rafRef.current = window.requestAnimationFrame(scrollLoop);
    }, [listRef, refreshTarget]);

    const finish = useCallback((commit: boolean) => {
        const press = pressRef.current;
        if (press?.active) {
            // The row under the pointer receives a click when the press ends on it; swallow that one.
            suppressClickUntilRef.current = Date.now() + 250;
            if (commit) {
                const nextIds = resolveDropOrder(press.siblingIds, press.taskId, press.target);
                if (!idsAreEqual(nextIds, press.siblingIds)) {
                    onReorderRef.current({ groupKey: press.groupKey, siblingIds: press.siblingIds, nextIds, movedId: press.taskId });
                }
            }
        }
        stopDrag();
    }, [stopDrag]);

    useEffect(() => () => {
        cleanupRef.current?.();
        if (rafRef.current !== null && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(rafRef.current);
    }, []);

    const beginPress = useCallback((
        event: ReactPointerEvent<HTMLElement>,
        taskId: string,
        groupKey: string,
        siblingIds: readonly string[],
        title: string,
    ) => {
        if (event.button !== 0 || !event.isPrimary || pressRef.current) return;
        if (event.target instanceof HTMLElement && event.target.closest(`[${REORDER_IGNORE_ATTR}]`)) return;
        const row = event.currentTarget;
        const rect = row.getBoundingClientRect();
        const press: Press = {
            pointerId: event.pointerId, taskId, groupKey, siblingIds, title,
            startX: event.clientX, startY: event.clientY, active: false, target: null,
            row, grabOffsetY: event.clientY - rect.top,
        };
        pressRef.current = press;
        pointerYRef.current = event.clientY;

        const onMove = (move: PointerEvent) => {
            if (move.pointerId !== press.pointerId) return;
            pointerYRef.current = move.clientY;
            if (!press.active) {
                if (!exceedsDragThreshold(move.clientX - press.startX, move.clientY - press.startY)) return;
                press.active = true;
                const bounds = press.row.getBoundingClientRect();
                document.body.style.userSelect = 'none';
                document.body.style.cursor = 'grabbing';
                window.getSelection?.()?.removeAllRanges();
                setGhost({ title: press.title, width: bounds.width, height: bounds.height, top: bounds.top, left: bounds.left });
                if (typeof window.requestAnimationFrame === 'function') rafRef.current = window.requestAnimationFrame(scrollLoop);
            }
            move.preventDefault();
            moveGhost(move.clientY);
            refreshTarget();
        };
        const onUp = (up: PointerEvent) => {
            if (up.pointerId !== press.pointerId) return;
            finish(true);
        };
        const onCancel = (cancel: PointerEvent) => {
            if (cancel.pointerId !== press.pointerId) return;
            finish(false);
        };
        const onKeyDown = (key: KeyboardEvent) => {
            if (key.key !== 'Escape' || !press.active) return;
            // Escape cancels the drag; preventDefault keeps the panel's own Escape handler from hiding it.
            key.preventDefault();
            key.stopPropagation();
            finish(false);
        };
        const onBlur = () => finish(false);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onCancel);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('blur', onBlur);
        cleanupRef.current = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onCancel);
            document.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('blur', onBlur);
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        };
    }, [finish, moveGhost, refreshTarget, scrollLoop]);

    /** True (once) right after a drag ended, so the row's click handler can ignore the trailing click. */
    const consumeSuppressedClick = useCallback((): boolean => {
        if (Date.now() < suppressClickUntilRef.current) {
            suppressClickUntilRef.current = 0;
            return true;
        }
        return false;
    }, []);

    return { state, ghost, ghostRef, beginPress, consumeSuppressedClick };
}
