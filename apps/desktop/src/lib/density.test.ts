import { describe, expect, it } from 'vitest';

import { nextDensityMode } from './density';

describe('nextDensityMode', () => {
    it('cycles comfortable -> compact -> condensed -> comfortable', () => {
        expect(nextDensityMode('comfortable')).toBe('compact');
        expect(nextDensityMode('compact')).toBe('condensed');
        expect(nextDensityMode('condensed')).toBe('comfortable');
    });

    it('treats an unknown value as comfortable and advances to compact', () => {
        expect(nextDensityMode(undefined)).toBe('compact');
        expect(nextDensityMode('bogus')).toBe('compact');
    });
});
