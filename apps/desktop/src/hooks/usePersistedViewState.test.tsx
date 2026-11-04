import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { usePersistedViewState } from './usePersistedViewState';

describe('usePersistedViewState', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('restores sanitized view state from local storage', () => {
        window.localStorage.setItem('stride:test:view', JSON.stringify({ showArchived: true }));

        const { result } = renderHook(() => usePersistedViewState(
            'stride:test:view',
            { showArchived: false },
            (value, fallback) => {
                const parsed = value && typeof value === 'object' && !Array.isArray(value)
                    ? value as { showArchived?: unknown }
                    : {};
                return {
                    showArchived: typeof parsed.showArchived === 'boolean'
                        ? parsed.showArchived
                        : fallback.showArchived,
                };
            }
        ));

        expect(result.current[0]).toEqual({ showArchived: true });
    });

    it('persists updates when view state changes', () => {
        const { result } = renderHook(() => usePersistedViewState(
            'stride:test:view',
            { showArchived: false }
        ));

        act(() => {
            result.current[1]((current) => ({ ...current, showArchived: true }));
        });

        expect(JSON.parse(window.localStorage.getItem('stride:test:view') || '{}')).toEqual({
            showArchived: true,
        });
    });

    it('loads and writes the new view state when its storage key changes', () => {
        window.localStorage.setItem('stride:test:inbox', JSON.stringify({ collapsed: ['inbox-group'] }));
        window.localStorage.setItem('stride:test:done', JSON.stringify({ collapsed: ['done-group'] }));

        const { result, rerender } = renderHook(
            ({ storageKey }) => usePersistedViewState(storageKey, { collapsed: [] as string[] }),
            { initialProps: { storageKey: 'stride:test:inbox' } },
        );

        expect(result.current[0].collapsed).toEqual(['inbox-group']);

        rerender({ storageKey: 'stride:test:done' });
        expect(result.current[0].collapsed).toEqual(['done-group']);

        act(() => {
            result.current[1]((current) => ({ collapsed: [...current.collapsed, 'another-done-group'] }));
        });

        expect(JSON.parse(window.localStorage.getItem('stride:test:done') || '{}')).toEqual({
            collapsed: ['done-group', 'another-done-group'],
        });
        expect(JSON.parse(window.localStorage.getItem('stride:test:inbox') || '{}')).toEqual({
            collapsed: ['inbox-group'],
        });
    });
});
