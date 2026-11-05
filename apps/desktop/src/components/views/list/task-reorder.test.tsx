import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
    ReorderDropZone,
    ReorderProvider,
    ReorderableTaskRow,
    useReorderController,
    type CrossGroupDropCheck,
    type ReorderHandler,
} from './task-reorder';

type Group = { key: string; ids: string[]; locked?: boolean; zone?: boolean };

function Harness({ groups, onReorder, canDropAcross }: {
    groups: Group[];
    onReorder: ReorderHandler;
    canDropAcross?: CrossGroupDropCheck;
}) {
    const controller = useReorderController(onReorder, { canDropAcross });
    return (
        <ReorderProvider value={controller}>
            <ReorderDropZone>
                {groups.map((group) => {
                    const rows = group.ids.map((id) => (
                        <ReorderableTaskRow key={id} taskId={id} groupKey={group.key} siblingIds={group.ids} locked={group.locked}>
                            <div data-task-id={id} draggable>{id}</div>
                        </ReorderableTaskRow>
                    ));
                    return group.zone
                        ? <ReorderDropZone key={group.key} groupKey={group.key} siblingIds={group.ids}><div data-testid={`zone-${group.key}`}>{rows}</div></ReorderDropZone>
                        : <div key={group.key}>{rows}</div>;
                })}
                <div data-testid="gap" />
            </ReorderDropZone>
        </ReorderProvider>
    );
}

const transfer = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: 'move', dropEffect: 'move', types: [] });
const row = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-reorder-row="${id}"]`)!;
const card = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!;

describe('unified task drag (task-reorder)', () => {
    it('reorders within a group and reports both group keys', () => {
        const onReorder = vi.fn();
        const { container } = render(<Harness groups={[{ key: 'g', ids: ['a', 'b', 'c'] }]} onReorder={onReorder} />);
        const data = transfer();
        fireEvent.dragStart(card(container, 'a'), { dataTransfer: data });
        expect(row(container, 'a').className).toContain('opacity-50');
        fireEvent.dragOver(row(container, 'c'), { dataTransfer: data, clientY: 10 });
        fireEvent.drop(row(container, 'c'), { dataTransfer: data, clientY: 10 });
        expect(onReorder).toHaveBeenCalledWith({
            groupKey: 'g', sourceGroupKey: 'g', siblingIds: ['a', 'b', 'c'], nextIds: ['b', 'c', 'a'], movedId: 'a', source: 'drag',
        });
        expect(row(container, 'a').className).not.toContain('opacity-50');
    });

    it('keeps the drop line while the pointer crosses the gap between rows and drops there', () => {
        const onReorder = vi.fn();
        const { container, getByTestId } = render(<Harness groups={[{ key: 'g', ids: ['a', 'b', 'c'] }]} onReorder={onReorder} />);
        const data = transfer();
        fireEvent.dragStart(card(container, 'a'), { dataTransfer: data });
        fireEvent.dragOver(row(container, 'b'), { dataTransfer: data, clientY: 10 });
        const gapAccepted = !fireEvent.dragOver(getByTestId('gap'), { dataTransfer: data, clientY: 10 });
        expect(gapAccepted).toBe(true);
        expect(container.querySelector('[data-reorder-drop-line="bottom"]')).not.toBeNull();
        fireEvent.drop(getByTestId('gap'), { dataTransfer: data, clientY: 10 });
        expect(onReorder).toHaveBeenCalledWith(expect.objectContaining({ nextIds: ['b', 'a', 'c'], movedId: 'a' }));
    });

    it('refuses a drop on a time-ordered group and says why', () => {
        const onReorder = vi.fn();
        const { container } = render(<Harness groups={[{ key: 'timed', ids: ['a', 'b'], locked: true }]} onReorder={onReorder} />);
        const data = transfer();
        fireEvent.dragStart(card(container, 'a'), { dataTransfer: data });
        const accepted = !fireEvent.dragOver(row(container, 'b'), { dataTransfer: data, clientY: 10 });
        expect(accepted).toBe(false);
        expect(row(container, 'b').querySelector('[data-reorder-blocked]')).toHaveTextContent('Sorted by time');
        fireEvent.drop(row(container, 'b'), { dataTransfer: data, clientY: 10 });
        expect(onReorder).not.toHaveBeenCalled();
    });

    it('refuses cross-group drops unless the view allows them', () => {
        const onReorder = vi.fn();
        const groups = [{ key: 'one', ids: ['a'] }, { key: 'two', ids: ['b'] }];
        const { container } = render(<Harness groups={groups} onReorder={onReorder} />);
        const data = transfer();
        fireEvent.dragStart(card(container, 'a'), { dataTransfer: data });
        fireEvent.dragOver(row(container, 'b'), { dataTransfer: data, clientY: 10 });
        expect(row(container, 'b').querySelector('[data-reorder-blocked]')).toHaveTextContent("Can't move here");
        fireEvent.drop(row(container, 'b'), { dataTransfer: data, clientY: 10 });
        expect(onReorder).not.toHaveBeenCalled();
    });

    it('inserts a row from another group at the drop position when allowed, or appends on the group zone', () => {
        const onReorder = vi.fn();
        const groups = [{ key: 'focus', ids: ['f1', 'f2'], zone: true }, { key: 'next', ids: ['n1', 'n2'] }];
        const canDropAcross: CrossGroupDropCheck = ({ targetGroupKey }) => targetGroupKey === 'focus';
        const { container, getByTestId } = render(<Harness groups={groups} onReorder={onReorder} canDropAcross={canDropAcross} />);
        let data = transfer();
        fireEvent.dragStart(card(container, 'n1'), { dataTransfer: data });
        fireEvent.dragOver(row(container, 'f1'), { dataTransfer: data, clientY: 10 });
        fireEvent.drop(row(container, 'f1'), { dataTransfer: data, clientY: 10 });
        expect(onReorder).toHaveBeenLastCalledWith(expect.objectContaining({
            groupKey: 'focus', sourceGroupKey: 'next', nextIds: ['f1', 'n1', 'f2'], movedId: 'n1',
        }));

        data = transfer();
        fireEvent.dragStart(card(container, 'n2'), { dataTransfer: data });
        fireEvent.dragOver(getByTestId('zone-focus'), { dataTransfer: data, clientY: 10 });
        expect(container.querySelector('[data-reorder-zone-active]')).not.toBeNull();
        fireEvent.drop(getByTestId('zone-focus'), { dataTransfer: data, clientY: 10 });
        expect(onReorder).toHaveBeenLastCalledWith(expect.objectContaining({ groupKey: 'focus', nextIds: ['f1', 'f2', 'n2'], movedId: 'n2' }));
    });

    it('ignores a drag the row cancelled (pressed on a control) and clears on dragend (Esc)', () => {
        const onReorder = vi.fn();
        const { container } = render(<Harness groups={[{ key: 'g', ids: ['a', 'b'] }]} onReorder={onReorder} />);
        const cancelling = (event: Event) => event.preventDefault();
        card(container, 'a').addEventListener('dragstart', cancelling);
        fireEvent.dragStart(card(container, 'a'), { dataTransfer: transfer() });
        expect(row(container, 'a').className).not.toContain('opacity-50');
        card(container, 'a').removeEventListener('dragstart', cancelling);

        fireEvent.dragStart(card(container, 'a'), { dataTransfer: transfer() });
        expect(row(container, 'a').className).toContain('opacity-50');
        fireEvent.dragEnd(card(container, 'a'));
        expect(row(container, 'a').className).not.toContain('opacity-50');
    });

    it('nudges with Alt+Arrow keys', () => {
        const onReorder = vi.fn();
        const { container } = render(<Harness groups={[{ key: 'g', ids: ['a', 'b'] }]} onReorder={onReorder} />);
        fireEvent.keyDown(card(container, 'a'), { key: 'ArrowDown', altKey: true });
        expect(onReorder).toHaveBeenCalledWith(expect.objectContaining({ nextIds: ['b', 'a'], source: 'keyboard' }));
    });
});
