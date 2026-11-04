import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

const options = [
    { value: 'list', label: 'List' },
    { value: 'board', label: 'Board' },
    { value: 'off', label: 'Off', disabled: true },
];

describe('SegmentedControl', () => {
    it('renders a radiogroup with the selected radio checked', () => {
        const { getByRole } = render(
            <SegmentedControl aria-label="View" options={options} value="board" onChange={() => undefined} />,
        );
        expect(getByRole('radiogroup', { name: 'View' })).toBeTruthy();
        expect(getByRole('radio', { name: 'Board' }).getAttribute('aria-checked')).toBe('true');
        expect(getByRole('radio', { name: 'List' }).getAttribute('aria-checked')).toBe('false');
    });

    it('calls onChange on click and arrow keys, skipping disabled options', () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <SegmentedControl aria-label="View" options={options} value="board" onChange={onChange} />,
        );
        fireEvent.click(getByRole('radio', { name: 'List' }));
        expect(onChange).toHaveBeenLastCalledWith('list');
        fireEvent.keyDown(getByRole('radio', { name: 'Board' }), { key: 'ArrowRight' });
        expect(onChange).toHaveBeenLastCalledWith('list');
        fireEvent.keyDown(getByRole('radio', { name: 'Board' }), { key: 'ArrowLeft' });
        expect(onChange).toHaveBeenLastCalledWith('list');
    });

    it('uses a roving tabindex', () => {
        const { getByRole } = render(
            <SegmentedControl aria-label="View" options={options} value="list" onChange={() => undefined} />,
        );
        expect(getByRole('radio', { name: 'List' }).tabIndex).toBe(0);
        expect(getByRole('radio', { name: 'Board' }).tabIndex).toBe(-1);
    });
});
