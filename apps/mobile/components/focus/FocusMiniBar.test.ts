import { describe, expect, it } from 'vitest';
import { shouldShowFocusMini } from './FocusMiniBar';

describe('shouldShowFocusMini', () => {
    it('shows only for an open, minimised session once hydrated', () => {
        expect(shouldShowFocusMini({ open: true, presentation: 'mini', hydrating: false })).toBe(true);
        expect(shouldShowFocusMini({ open: true, presentation: 'full', hydrating: false })).toBe(false);
        expect(shouldShowFocusMini({ open: false, presentation: 'mini', hydrating: false })).toBe(false);
        expect(shouldShowFocusMini({ open: true, presentation: 'mini', hydrating: true })).toBe(false);
    });
});
