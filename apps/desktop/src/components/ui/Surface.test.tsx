import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Surface } from './Surface';
import { Well } from './Well';

describe('Surface', () => {
    it('renders a raised card by default', () => {
        const { getByTestId } = render(<Surface data-testid="s">x</Surface>);
        const el = getByTestId('s');
        expect(el.tagName).toBe('DIV');
        expect(el.className).toContain('shadow-soft-sm');
        expect(el.className).toContain('bg-card');
    });

    it('supports as, size and selected', () => {
        const { getByTestId } = render(<Surface as="li" size="lg" selected data-testid="s">x</Surface>);
        const el = getByTestId('s');
        expect(el.tagName).toBe('LI');
        expect(el.className).toContain('shadow-soft');
        expect(el.className).toContain('bg-accent-soft');
        expect(el.getAttribute('data-selected')).toBe('true');
    });
});

describe('Well', () => {
    it('renders an inset well', () => {
        const { getByTestId } = render(<Well as="section" data-testid="w">x</Well>);
        const el = getByTestId('w');
        expect(el.tagName).toBe('SECTION');
        expect(el.className).toContain('bg-well');
        expect(el.className).toContain('shadow-soft-inset');
    });
});
