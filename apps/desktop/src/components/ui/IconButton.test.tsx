import { createRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

describe('IconButton', () => {
    it('exposes its aria-label, defaults to type=button and forwards ref', () => {
        const ref = createRef<HTMLButtonElement>();
        const { getByRole } = render(<IconButton ref={ref} aria-label="Filter"><svg /></IconButton>);
        const button = getByRole('button', { name: 'Filter' }) as HTMLButtonElement;
        expect(button.type).toBe('button');
        expect(ref.current).toBe(button);
        expect(button.className).toContain('h-8');
    });

    it('fires onClick unless disabled', () => {
        const onClick = vi.fn();
        const { getByRole, rerender } = render(<IconButton aria-label="More" onClick={onClick}><svg /></IconButton>);
        fireEvent.click(getByRole('button', { name: 'More' }));
        expect(onClick).toHaveBeenCalledTimes(1);
        rerender(<IconButton aria-label="More" onClick={onClick} disabled><svg /></IconButton>);
        fireEvent.click(getByRole('button', { name: 'More' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('supports the ghost variant and small size', () => {
        const { getByRole } = render(<IconButton aria-label="Close" variant="ghost" size="sm"><svg /></IconButton>);
        const button = getByRole('button', { name: 'Close' });
        expect(button.className).toContain('h-7');
        expect(button.className).not.toContain('shadow-soft-sm');
    });
});
