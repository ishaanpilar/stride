import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore, type Area, type Person } from '@stride/core';

import { AreaContextEditor, AreaContextToggle } from './AreaContextEditor';

const initialTaskState = useTaskStore.getState();
const T = '2026-11-05T09:00:00.000Z';
const t = (key: string) => key;

const area = (overrides: Partial<Area> = {}): Area => ({
    id: 'area-frackly', name: 'Frackly Works', order: 0, createdAt: T, updatedAt: T,
    description: '3D printing company.', keywords: ['Printstick'], peopleIds: ['p-akash'], ...overrides,
});
const akash: Person = { id: 'p-akash', name: 'Akash', createdAt: T, updatedAt: T };
const neha: Person = { id: 'p-neha', name: 'Neha', createdAt: T, updatedAt: T };

describe('AreaContextEditor', () => {
    let updateArea: ReturnType<typeof vi.fn>;
    let addPerson: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        useTaskStore.setState(initialTaskState, true);
        updateArea = vi.fn(async () => ({ success: true }));
        addPerson = vi.fn(async (name: string) => ({ id: `p-${name.toLowerCase()}`, name, createdAt: T, updatedAt: T }));
        useTaskStore.setState({ people: [akash, neha], _allPeople: [akash, neha], updateArea, addPerson } as never);
    });

    it('shows the description, keyword chips and linked people with accessible labels', () => {
        const view = render(<AreaContextEditor area={area()} t={t} />);
        expect(view.getByLabelText('Description')).toHaveValue('3D printing company.');
        expect(view.getByLabelText('Description')).toHaveAttribute('placeholder', 'What belongs here: clients, people, products, keywords');
        expect(view.getByRole('button', { name: 'Remove keyword Printstick' })).toBeInTheDocument();
        expect(view.getByRole('button', { name: 'Remove Akash' })).toBeInTheDocument();
    });

    it('saves the description on blur and only when it changed', () => {
        const view = render(<AreaContextEditor area={area()} t={t} />);
        const field = view.getByLabelText('Description');
        fireEvent.blur(field);
        expect(updateArea).not.toHaveBeenCalled();
        fireEvent.change(field, { target: { value: '  3D printing; I run creative direction.  ' } });
        fireEvent.blur(field);
        expect(updateArea).toHaveBeenCalledWith('area-frackly', { description: '3D printing; I run creative direction.' });
    });

    it('adds and removes keywords', () => {
        const view = render(<AreaContextEditor area={area()} t={t} />);
        const input = view.getByLabelText('Keywords');
        fireEvent.change(input, { target: { value: 'Resin, Filament' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(updateArea).toHaveBeenLastCalledWith('area-frackly', { keywords: ['Printstick', 'Resin', 'Filament'] });
        fireEvent.click(view.getByRole('button', { name: 'Remove keyword Printstick' }));
        expect(updateArea).toHaveBeenLastCalledWith('area-frackly', { keywords: undefined });
    });

    it('links an existing person, creates a new one, and unlinks', async () => {
        const view = render(<AreaContextEditor area={area()} t={t} />);
        const input = view.getByLabelText('People');
        fireEvent.change(input, { target: { value: 'neha' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(updateArea).toHaveBeenLastCalledWith('area-frackly', { peopleIds: ['p-akash', 'p-neha'] }));
        expect(addPerson).not.toHaveBeenCalled();
        fireEvent.change(input, { target: { value: 'Ravi' } });
        expect(view.getByText('New person: Ravi')).toBeInTheDocument();
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(addPerson).toHaveBeenCalledWith('Ravi'));
        fireEvent.click(view.getByRole('button', { name: 'Remove Akash' }));
        expect(updateArea).toHaveBeenLastCalledWith('area-frackly', { peopleIds: undefined });
    });

    it('Describe with AI: reviews the suggestion and saves it merged (append, union, new people created)', async () => {
        const describe = vi.fn(async () => ({
            description: 'The user is the creative director.', keywords: ['Printstick', '3D printing'], people: ['Akash', 'Ravi'], source: 'ai' as const,
        }));
        const view = render(<AreaContextEditor area={area()} t={t} describe={describe} />);
        fireEvent.click(view.getByRole('button', { name: 'Describe with AI' }));
        fireEvent.change(view.getByPlaceholderText('Tell the AI about this area: what it does, your role, products, people…'), {
            target: { value: 'I am the creative director. Printstick is ours. Akash and Ravi help.' },
        });
        fireEvent.click(view.getByRole('button', { name: 'Suggest' }));
        await waitFor(() => expect(view.getByTestId('area-context-suggestion')).toBeInTheDocument());
        expect(describe).toHaveBeenCalledWith('Frackly Works', 'I am the creative director. Printstick is ours. Akash and Ravi help.');
        expect(view.getByText(/will be added to People/)).toBeInTheDocument();
        fireEvent.click(view.getByRole('button', { name: 'Save to area' }));
        await waitFor(() => expect(updateArea).toHaveBeenCalledWith('area-frackly', {
            description: '3D printing company.\nThe user is the creative director.',
            keywords: ['Printstick', '3D printing'],
            peopleIds: ['p-akash', 'p-ravi'],
        }));
        expect(addPerson).toHaveBeenCalledWith('Ravi');
    });

    it('Describe with AI fallback keeps the paragraph and says so', async () => {
        const describe = vi.fn(async (_name: string, text: string) => ({ description: text, source: 'fallback' as const }));
        const view = render(<AreaContextEditor area={area({ description: undefined })} t={t} describe={describe} />);
        fireEvent.click(view.getByRole('button', { name: 'Describe with AI' }));
        fireEvent.change(view.getByPlaceholderText('Tell the AI about this area: what it does, your role, products, people…'), { target: { value: 'A 3D printing company.' } });
        fireEvent.click(view.getByRole('button', { name: 'Suggest' }));
        await waitFor(() => expect(view.getByRole('status')).toHaveTextContent('AI is unavailable, so your text was kept as the description.'));
        fireEvent.click(view.getByRole('button', { name: 'Save to area' }));
        await waitFor(() => expect(updateArea).toHaveBeenCalledWith('area-frackly', expect.objectContaining({ description: 'A 3D printing company.' })));
    });

    it('toggle exposes expanded state and marks areas that have context', () => {
        const onToggle = vi.fn();
        const view = render(<AreaContextToggle area={area()} open={false} onToggle={onToggle} label="Area context: Frackly Works" />);
        const button = view.getByRole('button', { name: 'Area context: Frackly Works' });
        expect(button).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(button);
        expect(onToggle).toHaveBeenCalled();
    });
});
