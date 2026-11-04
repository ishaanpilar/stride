import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './Switch';

describe('Switch', () => {
    it('exposes switch semantics and the checked state', () => {
        const { getByRole } = render(<Switch checked aria-label="Show task age" />);

        expect(getByRole('switch', { name: 'Show task age' })).toHaveAttribute('aria-checked', 'true');
    });

    it('requests the next state on click', () => {
        const onCheckedChange = vi.fn();
        const { getByRole } = render(
            <Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Show task age" />,
        );

        fireEvent.click(getByRole('switch', { name: 'Show task age' }));
        expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('uses theme tokens for both thumb states', () => {
        const { getByRole, rerender } = render(<Switch checked={false} aria-label="Theme-safe switch" />);
        const switchElement = getByRole('switch', { name: 'Theme-safe switch' });
        expect(switchElement.firstElementChild?.className).toContain('bg-foreground');

        rerender(<Switch checked aria-label="Theme-safe switch" />);
        expect(switchElement.firstElementChild?.className).toContain('bg-primary-foreground');
    });

    it('keeps the off track distinct from the cards it sits in', () => {
        const { getByRole } = render(<Switch checked={false} aria-label="Off switch" />);

        expect(getByRole('switch', { name: 'Off switch' }).className).not.toContain('bg-card');
    });
});
