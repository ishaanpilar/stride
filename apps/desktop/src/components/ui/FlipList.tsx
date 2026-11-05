import { Component, createRef, type ReactNode } from 'react';

import { MOTION_DURATION, MOTION_EASING, canAnimate } from '../../lib/motion';

type FlipListProps = {
    signature: string;
    children: ReactNode;
    id?: string;
    className?: string;
    itemSelector?: string;
    keyAttribute?: string;
};

type FlipSnapshot = Map<string, number> | null;

const MAX_FLIP_ITEMS = 150;
const MAX_ENTERING_ITEMS = 6;
const MOVE_DURATION_MS = 280;

const ENTER_KEYFRAMES: Keyframe[] = [
    { opacity: 0, transform: 'translateY(10px)' },
    { opacity: 1, transform: 'none' },
];

export class FlipList extends Component<FlipListProps> {
    private readonly rootRef = createRef<HTMLDivElement>();

    private collectItems(): Array<[string, HTMLElement]> {
        const root = this.rootRef.current;
        if (!root) return [];
        const selector = this.props.itemSelector ?? '[data-task-id]';
        const attribute = this.props.keyAttribute ?? 'data-task-id';
        const items: Array<[string, HTMLElement]> = [];
        root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
            if (element.closest('[data-exit-ghost]')) return;
            const enclosingItem = element.parentElement?.closest(selector);
            if (enclosingItem && root.contains(enclosingItem)) return;
            const key = element.getAttribute(attribute);
            if (key) items.push([key, element]);
        });
        return items;
    }

    getSnapshotBeforeUpdate(previous: FlipListProps): FlipSnapshot {
        if (previous.signature === this.props.signature || !canAnimate()) return null;
        const items = this.collectItems();
        if (items.length === 0 || items.length > MAX_FLIP_ITEMS) return null;
        const tops = new Map<string, number>();
        items.forEach(([key, element]) => tops.set(key, element.getBoundingClientRect().top));
        return tops;
    }

    componentDidUpdate(_previous: FlipListProps, _state: unknown, snapshot: FlipSnapshot): void {
        if (!snapshot) return;
        let entering = 0;
        this.collectItems().forEach(([key, element]) => {
            const before = snapshot.get(key);
            if (before === undefined) {
                if (entering >= MAX_ENTERING_ITEMS) return;
                entering += 1;
                element.animate(ENTER_KEYFRAMES, { duration: MOTION_DURATION.list, easing: MOTION_EASING.out });
                return;
            }
            const delta = before - element.getBoundingClientRect().top;
            if (Math.abs(delta) < 1) return;
            element.animate(
                [{ transform: `translateY(${delta}px)` }, { transform: 'none' }],
                { duration: MOVE_DURATION_MS, easing: MOTION_EASING.out },
            );
        });
    }

    render() {
        return (
            <div ref={this.rootRef} id={this.props.id} className={this.props.className}>
                {this.props.children}
            </div>
        );
    }
}
