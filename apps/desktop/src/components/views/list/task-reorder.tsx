import {
    createContext,
    memo,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useSyncExternalStore,
    type DragEvent as ReactDragEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
} from 'react';
import { GripVertical } from 'lucide-react';
import { moveIdByOffset, reorderIdsForDrop, type DropPlacement } from '@stride/core';
import { canAnimate, MOTION_DURATION, MOTION_EASING } from '../../../lib/motion';
import { cn } from '../../../lib/utils';

export type ReorderChange = {
    groupKey: string;
    sourceGroupKey: string;
    siblingIds: readonly string[];
    nextIds: string[];
    movedId: string;
    source: 'drag' | 'keyboard';
};

export type ReorderHandler = (change: ReorderChange) => void;

export type CrossGroupDropCheck = (drop: { movedId: string; sourceGroupKey: string; targetGroupKey: string }) => true | string | false;

export type ReorderLabels = {
    sortedByTime: string;
    cannotDropHere: string;
};

type ReorderState = {
    dragId: string | null;
    groupKey: string | null;
    targetId: string | null;
    targetGroupKey: string | null;
    placement: DropPlacement | null;
    blocked: string | null;
    zoneKey: string | null;
};

const IDLE: ReorderState = {
    dragId: null, groupKey: null, targetId: null, targetGroupKey: null, placement: null, blocked: null, zoneKey: null,
};

type SettleEntry = { top: number; signature: string; at: number };

export type ReorderController = {
    getState: () => ReorderState;
    subscribe: (listener: () => void) => () => void;
    set: (next: ReorderState) => void;
    onReorderRef: { current: ReorderHandler };
    canDropAcrossRef: { current: CrossGroupDropCheck | undefined };
    labelsRef: { current: ReorderLabels };
    session: { scroller: HTMLElement | null; grabOffsetY: number; lastDragOverAt: number };
    settle: Map<string, SettleEntry>;
    siblings: Map<string, readonly string[]>;
};

const DEFAULT_LABELS: ReorderLabels = { sortedByTime: 'Sorted by time', cannotDropHere: "Can't move here" };

export function useReorderController(
    onReorder: ReorderHandler,
    options: { canDropAcross?: CrossGroupDropCheck; labels?: ReorderLabels } = {},
): ReorderController {
    const handlerRef = useRef(onReorder);
    handlerRef.current = onReorder;
    const canDropAcrossRef = useRef(options.canDropAcross);
    canDropAcrossRef.current = options.canDropAcross;
    const labelsRef = useRef(options.labels ?? DEFAULT_LABELS);
    labelsRef.current = options.labels ?? DEFAULT_LABELS;
    return useMemo(() => {
        let state = IDLE;
        const listeners = new Set<() => void>();
        return {
            getState: () => state,
            subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
            set: (next) => {
                if (state.dragId === next.dragId && state.groupKey === next.groupKey
                    && state.targetId === next.targetId && state.targetGroupKey === next.targetGroupKey
                    && state.placement === next.placement
                    && state.blocked === next.blocked && state.zoneKey === next.zoneKey) return;
                state = next;
                listeners.forEach((listener) => listener());
            },
            onReorderRef: handlerRef,
            canDropAcrossRef,
            labelsRef,
            session: { scroller: null, grabOffsetY: 0, lastDragOverAt: 0 },
            settle: new Map(),
            siblings: new Map(),
        };
    }, []);
}

const ReorderContext = createContext<ReorderController | null>(null);

const EDGE_PX = 64;
const MAX_SCROLL_STEP = 22;
const SETTLE_TTL_MS = 1500;
const LOST_DRAG_MS = 1000;

function findScrollParent(element: HTMLElement | null): HTMLElement | null {
    let node = element?.parentElement ?? null;
    while (node) {
        const overflowY = getComputedStyle(node).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
        node = node.parentElement;
    }
    return null;
}

function autoScroll(scroller: HTMLElement, clientX: number, clientY: number) {
    const rect = scroller.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right) return;
    const fromTop = clientY - rect.top;
    const fromBottom = rect.bottom - clientY;
    if (fromTop < EDGE_PX) {
        scroller.scrollTop -= Math.ceil(MAX_SCROLL_STEP * (1 - Math.max(0, fromTop) / EDGE_PX));
    } else if (fromBottom < EDGE_PX) {
        scroller.scrollTop += Math.ceil(MAX_SCROLL_STEP * (1 - Math.max(0, fromBottom) / EDGE_PX));
    }
}

const isTypingTarget = (target: EventTarget | null) => (
    target instanceof HTMLElement
    && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'))
);

const isOverReorderSurface = (target: EventTarget | null) => (
    target instanceof Element && Boolean(target.closest('[data-reorder-row], [data-reorder-zone]'))
);

export function ReorderProvider({ value, children }: { value: ReorderController; children: ReactNode }) {
    useEffect(() => {
        const reset = () => {
            if (value.getState().dragId) value.set(IDLE);
        };
        const resetLostDrag = () => {
            if (Date.now() - value.session.lastDragOverAt > LOST_DRAG_MS) reset();
        };
        const handleDragOver = (event: DragEvent) => {
            const state = value.getState();
            if (!state.dragId) return;
            value.session.lastDragOverAt = Date.now();
            if (value.session.scroller) autoScroll(value.session.scroller, event.clientX, event.clientY);
            if (!isOverReorderSurface(event.target) && (state.targetId || state.zoneKey || state.blocked)) {
                value.set({ ...state, targetId: null, targetGroupKey: null, placement: null, blocked: null, zoneKey: null });
            }
        };
        document.addEventListener('dragover', handleDragOver, true);
        document.addEventListener('drop', reset);
        document.addEventListener('dragend', reset);
        document.addEventListener('pointermove', resetLostDrag);
        return () => {
            document.removeEventListener('dragover', handleDragOver, true);
            document.removeEventListener('drop', reset);
            document.removeEventListener('dragend', reset);
            document.removeEventListener('pointermove', resetLostDrag);
        };
    }, [value]);
    return <ReorderContext.Provider value={value}>{children}</ReorderContext.Provider>;
}

function dropVerdict(controller: ReorderController, state: ReorderState, groupKey: string, locked: boolean): true | string {
    const labels = controller.labelsRef.current;
    if (!state.dragId || !state.groupKey) return labels.cannotDropHere;
    if (state.groupKey === groupKey) return locked ? labels.sortedByTime : true;
    const verdict = controller.canDropAcrossRef.current?.({
        movedId: state.dragId,
        sourceGroupKey: state.groupKey,
        targetGroupKey: groupKey,
    });
    if (verdict === true) return true;
    if (typeof verdict === 'string') return verdict;
    return locked ? labels.sortedByTime : labels.cannotDropHere;
}

function insertForDrop(siblingIds: readonly string[], movedId: string, targetId: string | null, placement: DropPlacement): string[] {
    if (siblingIds.includes(movedId)) {
        return targetId ? reorderIdsForDrop(siblingIds, movedId, targetId, placement) : [...siblingIds.filter((id) => id !== movedId), movedId];
    }
    const next = [...siblingIds];
    const index = targetId ? next.indexOf(targetId) : -1;
    if (index === -1) next.push(movedId);
    else next.splice(placement === 'before' ? index : index + 1, 0, movedId);
    return next;
}

function recordSettle(controller: ReorderController, groupKeys: string[], movedId: string, dropClientY: number) {
    const now = Date.now();
    controller.settle.clear();
    const rows = document.querySelectorAll<HTMLElement>('[data-reorder-row]');
    rows.forEach((row) => {
        const group = row.getAttribute('data-reorder-group');
        const id = row.getAttribute('data-reorder-row');
        if (!id || !group || !groupKeys.includes(group)) return;
        const signature = row.getAttribute('data-reorder-signature') ?? '';
        const top = id === movedId && Number.isFinite(dropClientY)
            ? dropClientY - controller.session.grabOffsetY
            : row.getBoundingClientRect().top;
        controller.settle.set(id, { top, signature, at: now });
    });
}

function finishDrop(
    controller: ReorderController,
    state: ReorderState,
    groupKey: string,
    siblingIds: readonly string[],
    targetId: string | null,
    clientY: number,
) {
    const movedId = state.dragId as string;
    const sourceGroupKey = state.groupKey as string;
    const placement = state.placement ?? 'after';
    controller.set(IDLE);
    if (movedId === targetId) return;
    const nextIds = insertForDrop(siblingIds, movedId, targetId, placement);
    if (sourceGroupKey === groupKey && nextIds.every((id, index) => id === siblingIds[index])) return;
    recordSettle(controller, [groupKey, sourceGroupKey], movedId, clientY);
    controller.onReorderRef.current({ groupKey, sourceGroupKey, siblingIds, nextIds, movedId, source: 'drag' });
}

type ReorderableTaskRowProps = {
    taskId: string;
    groupKey: string;
    siblingIds: readonly string[];
    enabled?: boolean;
    locked?: boolean;
    dragLabel?: string;
    children: ReactNode;
};

export const ReorderableTaskRow = memo(function ReorderableTaskRow({
    taskId,
    groupKey,
    siblingIds,
    enabled = true,
    locked = false,
    dragLabel,
    children,
}: ReorderableTaskRowProps) {
    const controller = useContext(ReorderContext);
    const rowRef = useRef<HTMLDivElement>(null);
    const subscribe = controller?.subscribe ?? noopSubscribe;
    const isDragging = useSyncExternalStore(
        subscribe,
        () => controller?.getState().dragId === taskId,
        () => false,
    );
    const placement = useSyncExternalStore(
        subscribe,
        () => (controller?.getState().targetId === taskId ? controller.getState().placement : null),
        () => null,
    );
    const blocked = useSyncExternalStore(
        subscribe,
        () => (controller?.getState().targetId === taskId ? controller.getState().blocked : null),
        () => null,
    );
    const signature = useMemo(() => siblingIds.join('|'), [siblingIds]);
    const active = Boolean(controller) && enabled;

    useEffect(() => {
        if (!controller || !enabled || locked) return;
        controller.siblings.set(groupKey, siblingIds);
    }, [controller, enabled, groupKey, locked, siblingIds]);

    useLayoutEffect(() => {
        if (!controller) return;
        const entry = controller.settle.get(taskId);
        if (!entry) return;
        if (Date.now() - entry.at > SETTLE_TTL_MS) {
            controller.settle.delete(taskId);
            return;
        }
        if (entry.signature === signature) return;
        controller.settle.delete(taskId);
        const row = rowRef.current;
        if (!row || !canAnimate()) return;
        const delta = entry.top - row.getBoundingClientRect().top;
        if (Math.abs(delta) < 1) return;
        row.animate(
            [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
            { duration: MOTION_DURATION.base, easing: MOTION_EASING.out },
        );
    });

    const handleDragStart = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
        if (!controller || !enabled || event.defaultPrevented) return;
        const source = (event.target as HTMLElement | null)?.closest?.('[data-task-id]');
        if (source && source.getAttribute('data-task-id') !== taskId) return;
        const row = rowRef.current;
        const rect = row?.getBoundingClientRect();
        controller.session.scroller = findScrollParent(row);
        controller.session.grabOffsetY = rect && Number.isFinite(event.clientY) ? Math.max(0, event.clientY - rect.top) : 0;
        controller.session.lastDragOverAt = Date.now();
        controller.set({ ...IDLE, dragId: taskId, groupKey });
    }, [controller, enabled, groupKey, taskId]);

    const handleDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
        if (!controller || !enabled) return;
        const state = controller.getState();
        if (!state.dragId) return;
        const verdict = dropVerdict(controller, state, groupKey, locked);
        if (state.dragId === taskId) {
            if (verdict === true) event.preventDefault();
            controller.set({ ...state, targetId: null, targetGroupKey: null, placement: null, blocked: null, zoneKey: null });
            return;
        }
        if (verdict !== true) {
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
            controller.set({ ...state, targetId: taskId, targetGroupKey: groupKey, placement: null, blocked: verdict, zoneKey: null });
            return;
        }
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        const row = rowRef.current;
        if (!row) return;
        const rect = row.getBoundingClientRect();
        const nextPlacement: DropPlacement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        controller.set({ ...state, targetId: taskId, targetGroupKey: groupKey, placement: nextPlacement, blocked: null, zoneKey: null });
    }, [controller, enabled, groupKey, locked, taskId]);

    const handleDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
        if (!controller || !enabled) return;
        const state = controller.getState();
        if (!state.dragId) return;
        if (dropVerdict(controller, state, groupKey, locked) !== true) return;
        event.preventDefault();
        event.stopPropagation();
        finishDrop(controller, state, groupKey, siblingIds, taskId, event.clientY);
    }, [controller, enabled, groupKey, locked, siblingIds, taskId]);

    const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!controller || !enabled || locked || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        const next = moveIdByOffset(siblingIds, taskId, event.key === 'ArrowUp' ? -1 : 1);
        if (next.every((id, index) => id === siblingIds[index])) return;
        controller.onReorderRef.current({ groupKey, sourceGroupKey: groupKey, siblingIds, nextIds: next, movedId: taskId, source: 'keyboard' });
        const root = rowRef.current;
        window.requestAnimationFrame(() => {
            const target = root?.ownerDocument.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`);
            target?.focus({ preventScroll: false });
        });
    }, [controller, enabled, groupKey, locked, siblingIds, taskId]);

    if (!active) return <>{children}</>;

    return (
        <div
            ref={rowRef}
            data-reorder-row={taskId}
            data-reorder-group={groupKey}
            data-reorder-signature={signature}
            data-reorder-locked={locked || undefined}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onKeyDown={handleKeyDown}
            className={cn(
                'group/reorder relative transition-[padding,opacity] duration-200 ease-out motion-reduce:transition-none',
                placement === 'before' && 'pt-3',
                placement === 'after' && 'pb-3',
                isDragging && 'opacity-50',
            )}
        >
            {placement === 'before' && <DropLine position="top" />}
            {!locked && (
                <span
                    aria-hidden="true"
                    title={dragLabel}
                    className="pointer-events-none absolute -left-5 top-1/2 hidden -translate-y-1/2 text-tertiary opacity-0 transition-opacity duration-200 group-hover/reorder:opacity-100 sm:block motion-reduce:transition-none"
                >
                    <GripVertical className="h-4 w-4" />
                </span>
            )}
            {children}
            {blocked && <BlockedOverlay label={blocked} />}
            {placement === 'after' && <DropLine position="bottom" />}
        </div>
    );
});

export function ReorderDropZone({
    groupKey,
    siblingIds,
    className,
    children,
}: {
    groupKey?: string;
    siblingIds?: readonly string[];
    className?: string;
    children: ReactNode;
}) {
    const controller = useContext(ReorderContext);
    const subscribe = controller?.subscribe ?? noopSubscribe;
    const highlighted = useSyncExternalStore(
        subscribe,
        () => Boolean(groupKey) && controller?.getState().zoneKey === groupKey,
        () => false,
    );

    const acceptsAppend = useCallback((state: ReorderState) => (
        Boolean(controller && groupKey && siblingIds && state.dragId && state.groupKey !== groupKey
            && dropVerdict(controller, state, groupKey, false) === true)
    ), [controller, groupKey, siblingIds]);

    const handleDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
        if (!controller || event.defaultPrevented) return;
        const state = controller.getState();
        if (!state.dragId) return;
        if (event.target instanceof Element && event.target.closest('[data-reorder-row]')) return;
        if (state.targetId && state.placement && !state.blocked) {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            return;
        }
        if (!acceptsAppend(state) || !groupKey) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        controller.set({ ...state, targetId: null, targetGroupKey: null, placement: null, blocked: null, zoneKey: groupKey });
    }, [acceptsAppend, controller, groupKey]);

    const handleDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
        if (!controller || event.defaultPrevented) return;
        const state = controller.getState();
        if (!state.dragId) return;
        if (state.targetId && state.targetGroupKey && state.placement && !state.blocked) {
            const targetSiblings = controller.siblings.get(state.targetGroupKey);
            if (!targetSiblings) return;
            event.preventDefault();
            finishDrop(controller, state, state.targetGroupKey, targetSiblings, state.targetId, event.clientY);
            return;
        }
        if (!acceptsAppend(state) || !groupKey || !siblingIds) return;
        event.preventDefault();
        finishDrop(controller, state, groupKey, siblingIds, null, event.clientY);
    }, [acceptsAppend, controller, groupKey, siblingIds]);

    return (
        <div
            data-reorder-zone={groupKey ?? ''}
            data-reorder-zone-active={highlighted || undefined}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className={cn(
                groupKey && 'rounded-card transition-[box-shadow,background-color] duration-200 ease-out motion-reduce:transition-none',
                highlighted && 'bg-accent-soft ring-2 ring-inset ring-accent-fill',
                className,
            )}
        >
            {children}
        </div>
    );
}

function BlockedOverlay({ label }: { label: string }) {
    return (
        <div
            aria-hidden="true"
            data-reorder-blocked
            className="pointer-events-none absolute inset-0 flex items-start justify-end rounded-card outline-dashed outline-2 -outline-offset-2 outline-tertiary/60"
        >
            <span className="m-1.5 rounded-pill bg-well px-2 py-0.5 text-xs font-medium text-muted-foreground shadow-soft-sm">
                {label}
            </span>
        </div>
    );
}

function DropLine({ position }: { position: 'top' | 'bottom' }) {
    return (
        <div
            aria-hidden="true"
            data-reorder-drop-line={position}
            className={cn(
                'pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-accent-fill shadow-[0_0_0_3px_hsl(var(--accent)/0.18)]',
                position === 'top' ? 'top-0.5' : 'bottom-0.5',
            )}
        />
    );
}

const noopSubscribe = () => () => undefined;
