import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ViewHeader } from './ViewHeader';

describe('ViewHeader', () => {
    it('renders the title as h1 with a count', () => {
        const { getByRole, getByTestId } = render(<ViewHeader title="Next Actions" count="15 tasks" />);
        expect(getByRole('heading', { level: 1, name: 'Next Actions' })).toBeTruthy();
        expect(getByTestId('view-header-count').textContent).toBe('15 tasks');
    });

    it('omits the count and progress when not provided', () => {
        const { queryByTestId, queryByRole } = render(<ViewHeader title="Inbox" />);
        expect(queryByTestId('view-header-count')).toBeNull();
        expect(queryByRole('progressbar')).toBeNull();
    });

    it('renders the progress line and bar', () => {
        const { getByText, getByRole } = render(
            <ViewHeader
                title="Today"
                progress={{ leftText: 'Today: 3 of 9 done', rightText: '6 left · about 2 h 10 m', value: 1 / 3 }}
            />,
        );
        expect(getByText('Today: 3 of 9 done')).toBeTruthy();
        expect(getByText('6 left · about 2 h 10 m')).toBeTruthy();
        const bar = getByRole('progressbar', { name: 'Today: 3 of 9 done' });
        expect(Number(bar.getAttribute('aria-valuenow'))).toBeCloseTo(1 / 3, 5);
        expect(bar.getAttribute('aria-valuemax')).toBe('1');
    });
});
