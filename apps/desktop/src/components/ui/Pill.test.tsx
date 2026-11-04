import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip, Pill } from './Pill';

describe('Pill', () => {
    it('defaults to the neutral tone', () => {
        const { getByText } = render(<Pill>Work</Pill>);
        expect(getByText('Work').className).toContain('bg-well');
    });

    it.each([
        ['accent', 'text-accent-text'],
        ['danger', 'text-danger-text'],
        ['warning', 'text-warning-text'],
        ['success', 'text-success-text'],
    ] as const)('applies the %s tone', (tone, cls) => {
        const { getByText } = render(<Pill tone={tone}>Label</Pill>);
        expect(getByText('Label').className).toContain(cls);
    });

    it('renders a decorative dot with a custom colour and an icon', () => {
        const { container, getByTestId } = render(
            <Pill dot="#ff0000" icon={<svg data-testid="i" />}>Project</Pill>,
        );
        const dot = container.querySelector('[data-pill-dot]') as HTMLElement;
        expect(dot.getAttribute('aria-hidden')).toBe('true');
        expect(dot.style.backgroundColor).toBe('rgb(255, 0, 0)');
        expect(getByTestId('i')).toBeTruthy();
    });

    it('exports Chip as an alias', () => {
        expect(Chip).toBe(Pill);
    });
});
