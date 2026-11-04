import { createRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchField } from './SearchField';

describe('SearchField', () => {
    it('labels the input from the placeholder and forwards the ref', () => {
        const ref = createRef<HTMLInputElement>();
        const { getByRole } = render(<SearchField ref={ref} placeholder="Search tasks..." shortcutHint="⌘F" />);
        const input = getByRole('searchbox', { name: 'Search tasks...' });
        expect(ref.current).toBe(input);
    });

    it('shows a decorative shortcut hint and reports changes', () => {
        const onChange = vi.fn();
        const { getByRole, getByText } = render(
            <SearchField aria-label="Find" shortcutHint="⌘F" value="" onChange={onChange} />,
        );
        expect(getByText('⌘F').getAttribute('aria-hidden')).toBe('true');
        fireEvent.change(getByRole('searchbox', { name: 'Find' }), { target: { value: 'abc' } });
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});
