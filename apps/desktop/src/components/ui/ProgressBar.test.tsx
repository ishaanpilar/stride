import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
    it('exposes progressbar semantics', () => {
        const { getByRole } = render(<ProgressBar value={3} max={9} aria-label="Today" valueText="3 of 9" />);
        const bar = getByRole('progressbar', { name: 'Today' });
        expect(bar.getAttribute('aria-valuenow')).toBe('3');
        expect(bar.getAttribute('aria-valuemax')).toBe('9');
        expect(bar.getAttribute('aria-valuemin')).toBe('0');
        expect(bar.getAttribute('aria-valuetext')).toBe('3 of 9');
        expect((bar.querySelector('[data-progress-fill]') as HTMLElement).style.width).toBe('33.33333333333333%');
    });

    it('clamps out-of-range and non-finite values', () => {
        const { getByRole, rerender } = render(<ProgressBar value={500} aria-label="p" />);
        expect(getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
        rerender(<ProgressBar value={-4} aria-label="p" />);
        expect(getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
        rerender(<ProgressBar value={Number.NaN} aria-label="p" />);
        expect(getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    });
});
