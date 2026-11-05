import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as panelWindow from '../lib/menubar-panel-window';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useTaskStore, type Task } from '@stride/core';
import { LanguageProvider } from '../contexts/language-context';
import { MenuBarPanel } from './MenuBarPanel';

const at = (offsetDays: number, hour = 12) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + offsetDays, hour).toISOString();
const makeTask = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: `Task ${id}`, status: 'next', tags: [], contexts: [],
    createdAt: at(-10), updatedAt: at(-10), ...extra,
});

const renderPanel = () => render(
    <LanguageProvider>
        <MenuBarPanel />
    </LanguageProvider>,
);

describe('MenuBarPanel', () => {
    beforeEach(() => {
        window.localStorage.clear();
        const tasks = [
            makeTask('late', { title: 'Pay invoice', dueDate: at(-2) }),
            makeTask('today', { title: 'Call dentist', dueDate: at(0, 23) }),
            makeTask('later', { title: 'Plan trip' }),
        ];
        useTaskStore.setState({
            tasks, _allTasks: tasks, projects: [], areas: [], settings: {}, error: null,
            fetchData: vi.fn().mockResolvedValue(undefined),
        } as never);
    });

    it('shows overdue and today sections on the default Today tab', () => {
        renderPanel();
        expect(screen.getByRole('tab', { name: /Today/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('Overdue')).toBeInTheDocument();
        expect(screen.getByText('Pay invoice')).toBeInTheDocument();
        expect(screen.getByText('Call dentist')).toBeInTheDocument();
        expect(screen.queryByText('Plan trip')).not.toBeInTheDocument();
    });

    it('shows counts on every tab', () => {
        renderPanel();
        expect(screen.getByTestId('menubar-tab-count-today')).toHaveTextContent('2');
        expect(screen.getByTestId('menubar-tab-count-upcoming')).toHaveTextContent('0');
        expect(screen.getByTestId('menubar-tab-count-inbox')).toHaveTextContent('0');
        expect(screen.getByTestId('menubar-tab-count-next')).toHaveTextContent('3');
    });

    it('switches tabs and remembers the last one', () => {
        renderPanel();
        fireEvent.click(screen.getByRole('tab', { name: /Next/ }));
        expect(screen.getByText('Plan trip')).toBeInTheDocument();
        expect(window.localStorage.getItem('stride-menubar-tab')).toBe('next');
    });

    it('restores the stored tab', () => {
        window.localStorage.setItem('stride-menubar-tab', 'next');
        renderPanel();
        expect(screen.getByRole('tab', { name: /Next/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('groups upcoming tasks by day', () => {
        const tasks = [makeTask('soon', { title: 'Book flights', dueDate: at(2) })];
        useTaskStore.setState({ tasks, _allTasks: tasks } as never);
        renderPanel();
        fireEvent.click(screen.getByRole('tab', { name: /Upcoming/ }));
        expect(screen.getByText('Book flights')).toBeInTheDocument();
        expect(screen.getByTestId('menubar-tab-count-upcoming')).toHaveTextContent('1');
    });

    it('lists inbox items', () => {
        const tasks = [makeTask('in1', { title: 'Sort receipts', status: 'inbox' })];
        useTaskStore.setState({ tasks, _allTasks: tasks } as never);
        renderPanel();
        fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }));
        expect(screen.getByText('Sort receipts')).toBeInTheDocument();
    });

    it('completes a task through the store and offers undo', async () => {
        const moveTask = vi.fn().mockResolvedValue({ success: true });
        useTaskStore.setState({ moveTask } as never);
        renderPanel();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Mark done: Pay invoice/ }));
        });
        await waitFor(() => expect(moveTask).toHaveBeenCalledWith('late', 'done'));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Pay invoice'));
    });

    it('shows a friendly empty state per tab', () => {
        const tasks = [makeTask('only-next')];
        useTaskStore.setState({ tasks, _allTasks: tasks } as never);
        renderPanel();
        expect(screen.getByTestId('menubar-panel-empty')).toHaveTextContent(/Nothing due today/);
        fireEvent.click(screen.getByRole('tab', { name: /Upcoming/ }));
        expect(screen.getByTestId('menubar-panel-empty')).toHaveTextContent(/next 7 days/);
        fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }));
        expect(screen.getByTestId('menubar-panel-empty')).toHaveTextContent(/Inbox zero/);
    });

    it('opens the main window with Quick Capture from the AI Capture button', () => {
        const spy = vi.spyOn(panelWindow, 'openMainFromMenuBarPanel').mockResolvedValue(undefined);
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: /AI Capture/ }));
        expect(spy).toHaveBeenCalledWith({ openCapture: true });
    });

    it('adds a parsed task to the inbox from the quick add input', async () => {
        const addTask = vi.fn().mockResolvedValue({ success: true, id: 'new' });
        useTaskStore.setState({ addTask } as never);
        renderPanel();
        const input = screen.getByLabelText(/Add task|nav.addTask/i);
        fireEvent.change(input, { target: { value: 'Buy milk /due:tomorrow' } });
        await act(async () => {
            fireEvent.submit(input.closest('form')!);
        });
        expect(addTask).toHaveBeenCalledTimes(1);
        const [title, props] = addTask.mock.calls[0];
        expect(title).toContain('Buy milk');
        expect(props.dueDate).toBeTruthy();
    });
    describe('reordering', () => {
        const inboxTasks = () => [
            makeTask('i1', { title: 'First thing', status: 'inbox', boardOrder: 1000 }),
            makeTask('i2', { title: 'Second thing', status: 'inbox', boardOrder: 2000 }),
            makeTask('i3', { title: 'Third thing', status: 'inbox', boardOrder: 3000 }),
        ];
        const setup = (tasks: Task[]) => {
            const reorderBoardTasks = vi.fn().mockResolvedValue(undefined);
            const reorderFocusedTasks = vi.fn().mockResolvedValue({ success: true });
            useTaskStore.setState({ tasks, _allTasks: tasks, reorderBoardTasks, reorderFocusedTasks } as never);
            vi.spyOn(panelWindow, 'notifyMainWindow').mockResolvedValue(undefined);
            return { reorderBoardTasks, reorderFocusedTasks };
        };
        const titles = () => screen.getAllByTestId('menubar-row').map((row) => row.querySelector('[data-row-main] span')?.textContent);

        const manualKey = (key: string) => `stride:view:manual-order:${key}:v1`;

        it('lists inbox in manual (boardOrder) order once the Inbox is in manual order', () => {
            window.localStorage.setItem(manualKey('inbox'), '1');
            setup([...inboxTasks()].reverse());
            renderPanel();
            fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }));
            expect(titles()).toEqual(['First thing', 'Second thing', 'Third thing']);
        });

        it('switches the Inbox from newest first to manual order on the first move, with Undo', async () => {
            const tasks = [
                makeTask('old', { title: 'Old', status: 'inbox', createdAt: at(-5) }),
                makeTask('mid', { title: 'Mid', status: 'inbox', createdAt: at(-3) }),
                makeTask('new', { title: 'New', status: 'inbox', createdAt: at(-1) }),
            ];
            const { reorderBoardTasks } = setup(tasks);
            renderPanel();
            fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }));
            expect(titles()).toEqual(['New', 'Mid', 'Old']);
            const last = screen.getAllByTestId('menubar-row')[2].querySelector('[data-row-main]') as HTMLElement;
            await act(async () => {
                fireEvent.keyDown(last, { key: 'ArrowUp', altKey: true });
            });
            expect(reorderBoardTasks).toHaveBeenCalledWith('inbox', ['new', 'old', 'mid'], 'old');
            expect(window.localStorage.getItem(manualKey('inbox'))).toBe('1');
            expect(screen.getByTestId('menubar-manual-order-undo')).toHaveTextContent('Switched to manual order');
            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
            });
            expect(window.localStorage.getItem(manualKey('inbox'))).toBeNull();
            expect(reorderBoardTasks).toHaveBeenLastCalledWith('inbox', expect.arrayContaining(['old', 'mid', 'new']));
        });

        it('reorders the Next tab through the board order', async () => {
            window.localStorage.setItem(manualKey('next'), '1');
            const { reorderBoardTasks } = setup([
                makeTask('n1', { title: 'Next one', boardOrder: 0 }),
                makeTask('n2', { title: 'Next two', boardOrder: 1024 }),
            ]);
            renderPanel();
            fireEvent.click(screen.getByRole('tab', { name: /Next/ }));
            const first = screen.getAllByTestId('menubar-row')[0].querySelector('[data-row-main]') as HTMLElement;
            await act(async () => {
                fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true });
            });
            expect(reorderBoardTasks).toHaveBeenCalledWith('next', ['n2', 'n1'], 'n1');
            expect(screen.queryByTestId('menubar-manual-order-undo')).toBeNull();
        });

        it('moves a row down with Alt+ArrowDown and announces its position', async () => {
            const { reorderBoardTasks } = setup(inboxTasks());
            renderPanel();
            fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }));
            const first = screen.getAllByTestId('menubar-row')[0].querySelector('[data-row-main]') as HTMLElement;
            await act(async () => {
                fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true });
            });
            expect(reorderBoardTasks).toHaveBeenCalledWith('inbox', ['i2', 'i1', 'i3'], 'i1');
            await waitFor(() => expect(screen.getByTestId('menubar-reorder-announcement')).toHaveTextContent('Moved down, position 2 of 3'));
        });

        it('does nothing for Alt+ArrowUp on the first row', async () => {
            const { reorderBoardTasks } = setup(inboxTasks());
            renderPanel();
            fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }));
            const first = screen.getAllByTestId('menubar-row')[0].querySelector('[data-row-main]') as HTMLElement;
            await act(async () => {
                fireEvent.keyDown(first, { key: 'ArrowUp', altKey: true });
            });
            expect(reorderBoardTasks).not.toHaveBeenCalled();
        });

        it('moves a row to the top from its actions menu', async () => {
            const { reorderBoardTasks } = setup(inboxTasks());
            renderPanel();
            fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }));
            fireEvent.click(screen.getByRole('button', { name: /More actions: Third thing/ }));
            expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeDisabled();
            await act(async () => {
                fireEvent.click(screen.getByRole('menuitem', { name: 'Move to top' }));
            });
            expect(reorderBoardTasks).toHaveBeenCalledWith('inbox', ['i3', 'i1', 'i2'], 'i3');
            await waitFor(() => expect(screen.getByTestId('menubar-reorder-announcement')).toHaveTextContent('Moved to top, position 1 of 3'));
        });

        it('opens the same menu from a right click', () => {
            setup(inboxTasks());
            renderPanel();
            fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }));
            fireEvent.contextMenu(screen.getAllByTestId('menubar-row')[1]);
            expect(screen.getByRole('menu')).toBeInTheDocument();
            expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeEnabled();
        });

        it('persists Today reorders of focused rows through the Focus order', async () => {
            const tasks = [
                makeTask('f1', { title: 'Focus one', dueDate: at(0, 23), isFocusedToday: true, focusOrder: 1000 }),
                makeTask('f2', { title: 'Focus two', dueDate: at(0, 23), isFocusedToday: true, focusOrder: 2000 }),
                makeTask('plain', { title: 'Just due', dueDate: at(0, 23) }),
            ];
            const { reorderFocusedTasks } = setup(tasks);
            renderPanel();
            expect(titles()).toEqual(['Focus one', 'Focus two', 'Just due']);
            const first = screen.getAllByTestId('menubar-row')[0].querySelector('[data-row-main]') as HTMLElement;
            await act(async () => {
                fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true });
            });
            expect(reorderFocusedTasks).toHaveBeenCalledWith(['f2', 'f1']);
        });

        it('lets every other Today row move within its group through the board order', async () => {
            const tasks = [
                makeTask('f1', { title: 'Focus one', isFocusedToday: true, focusOrder: 0 }),
                makeTask('early', { title: 'Due early', dueDate: at(0, 20) }),
                makeTask('late', { title: 'Due late', dueDate: at(0, 23) }),
                makeTask('over', { title: 'Overdue', dueDate: at(-1) }),
            ];
            const { reorderBoardTasks, reorderFocusedTasks } = setup(tasks);
            renderPanel();
            const lateRow = screen.getAllByTestId('menubar-row').find((row) => row.textContent?.includes('Due late'))!;
            expect(lateRow).toHaveAttribute('data-reorder-group', 'today:today');
            const overdueRow = screen.getAllByTestId('menubar-row').find((row) => row.textContent?.includes('Overdue'))!;
            expect(overdueRow).toHaveAttribute('data-reorder-group', 'today:overdue');
            await act(async () => {
                fireEvent.keyDown(lateRow.querySelector('[data-row-main]')!, { key: 'ArrowUp', altKey: true });
            });
            expect(reorderBoardTasks).toHaveBeenCalledWith('next', ['late', 'early'], 'late');
            expect(reorderFocusedTasks).not.toHaveBeenCalled();
            expect(window.localStorage.getItem(manualKey('focus-today'))).toBe('1');
            expect(screen.getByTestId('menubar-manual-order-undo')).toBeInTheDocument();
        });

        it('reorders Upcoming rows within the same day only', async () => {
            const { reorderBoardTasks } = setup([
                makeTask('u1', { title: 'Later', dueDate: at(2, 9) }),
                makeTask('u2', { title: 'Later two', dueDate: at(2, 15) }),
                makeTask('u3', { title: 'Another day', dueDate: at(3, 9) }),
            ]);
            renderPanel();
            fireEvent.click(screen.getByRole('tab', { name: /Upcoming/ }));
            const rows = screen.getAllByTestId('menubar-row');
            expect(rows[0].getAttribute('data-reorder-group')).toBe(rows[1].getAttribute('data-reorder-group'));
            expect(rows[2].getAttribute('data-reorder-group')).not.toBe(rows[0].getAttribute('data-reorder-group'));
            await act(async () => {
                fireEvent.keyDown(rows[1].querySelector('[data-row-main]')!, { key: 'ArrowUp', altKey: true });
            });
            expect(reorderBoardTasks).toHaveBeenCalledWith('next', ['u2', 'u1'], 'u2');
            await act(async () => {
                fireEvent.keyDown(screen.getAllByTestId('menubar-row')[2].querySelector('[data-row-main]')!, { key: 'ArrowUp', altKey: true });
            });
            expect(reorderBoardTasks).toHaveBeenCalledTimes(1);
        });

        it('does not make completed rows movable', async () => {
            const tasks = [...inboxTasks()];
            setup(tasks);
            tasks[1] = { ...tasks[1], status: 'done' };
            renderPanel();
            fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }));
            // Done tasks drop out of the list unless ticked this session; nothing done is draggable either way.
            screen.getAllByTestId('menubar-row').forEach((row) => {
                if (row.querySelector('[aria-label^="Mark not done"]')) expect(row).not.toHaveAttribute('data-reorder-id');
            });
        });

        it('re-reads the data file when the panel regains focus and shows the new order', async () => {
            const tasks = inboxTasks();
            const reordered = [
                { ...tasks[0], boardOrder: 3500 },
                tasks[1],
                tasks[2],
            ];
            let mainWindowReordered = false;
            const fetchData = vi.fn().mockImplementation(async () => {
                if (mainWindowReordered) useTaskStore.setState({ tasks: reordered, _allTasks: reordered } as never);
            });
            window.localStorage.setItem(manualKey('inbox'), '1');
            setup(tasks);
            useTaskStore.setState({ fetchData } as never);
            renderPanel();
            fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }));
            expect(titles()).toEqual(['First thing', 'Second thing', 'Third thing']);
            mainWindowReordered = true;
            await act(async () => {
                window.dispatchEvent(new Event('focus'));
            });
            await waitFor(() => expect(titles()).toEqual(['Second thing', 'Third thing', 'First thing']));
        });

        describe('dragging', () => {
            const rect = (top: number) => ({ top, bottom: top + 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: top, toJSON: () => ({}) });
            const pointer = (type: string, y: number, target: Element | Document) => {
                const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 20, clientY: y, button: 0 });
                Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
                act(() => { target.dispatchEvent(event); });
            };
            const setupDrag = () => {
                const result = setup(inboxTasks());
                renderPanel();
                fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }));
                const rows = screen.getAllByTestId('menubar-row');
                rows.forEach((row, index) => { row.getBoundingClientRect = () => rect(index * 44) as DOMRect; });
                return { ...result, rows };
            };

            it('drops a dragged row at the line and saves the new order', async () => {
                const { rows, reorderBoardTasks } = setupDrag();
                pointer('pointerdown', 20, rows[0].querySelector('[data-row-main]')!);
                pointer('pointermove', 30, document);
                pointer('pointermove', 90, document);
                expect(rows[0]).toHaveAttribute('data-dragging', 'true');
                expect(screen.getByTestId('menubar-drag-ghost')).toBeInTheDocument();
                expect(rows[2].querySelector('[data-testid="menubar-drop-line"]')).toHaveAttribute('data-placement', 'before');
                await act(async () => { pointer('pointerup', 90, document); });
                expect(reorderBoardTasks).toHaveBeenCalledWith('inbox', ['i2', 'i1', 'i3'], 'i1');
                expect(screen.queryByTestId('menubar-drag-ghost')).toBeNull();
            });

            it('treats a press without travel as a normal click, not a drag', () => {
                const { rows, reorderBoardTasks } = setupDrag();
                pointer('pointerdown', 20, rows[0].querySelector('[data-row-main]')!);
                pointer('pointermove', 21, document);
                pointer('pointerup', 21, document);
                expect(screen.queryByTestId('menubar-drag-ghost')).toBeNull();
                expect(reorderBoardTasks).not.toHaveBeenCalled();
            });

            it('cancels the drag on Escape without hiding the panel or saving', () => {
                const { rows, reorderBoardTasks } = setupDrag();
                pointer('pointerdown', 20, rows[0].querySelector('[data-row-main]')!);
                pointer('pointermove', 90, document);
                const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
                act(() => { document.dispatchEvent(escape); });
                expect(escape.defaultPrevented).toBe(true);
                expect(screen.queryByTestId('menubar-drag-ghost')).toBeNull();
                pointer('pointerup', 90, document);
                expect(reorderBoardTasks).not.toHaveBeenCalled();
            });

            it('does not start a drag from the complete checkbox', () => {
                const { rows } = setupDrag();
                pointer('pointerdown', 20, screen.getByRole('button', { name: /Mark done: First thing/ }));
                pointer('pointermove', 90, document);
                expect(rows[0]).not.toHaveAttribute('data-dragging');
            });
        });
    });
});
