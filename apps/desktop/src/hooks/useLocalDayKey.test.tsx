import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLocalDayKey } from './useLocalDayKey';

function DayProbe() {
    return <span>{useLocalDayKey()}</span>;
}

describe('useLocalDayKey', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('refreshes at local midnight and when the window regains focus', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 6, 27, 23, 59, 59, 900));
        const view = render(<DayProbe />);

        expect(view.getByText('2026-6-27')).toBeInTheDocument();
        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(view.getByText('2026-6-28')).toBeInTheDocument();

        vi.setSystemTime(new Date(2026, 6, 29, 9, 0, 0));
        act(() => {
            window.dispatchEvent(new Event('focus'));
        });
        expect(view.getByText('2026-6-29')).toBeInTheDocument();
    });
});
