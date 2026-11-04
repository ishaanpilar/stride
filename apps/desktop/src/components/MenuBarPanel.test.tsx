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
});
