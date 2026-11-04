import { describe, expect, it } from 'vitest';
import { initializeSandboxRuntime } from '@stride/core';
import { getWorkspaceCache } from './workspace-cache';

describe('sandbox workspace cache', () => {
    it('keeps session UI state out of personal local storage', () => {
        window.localStorage.setItem('stride:test:private-draft', 'personal');
        initializeSandboxRuntime(true);

        const cache = getWorkspaceCache();
        expect(cache?.getItem('stride:test:private-draft')).toBeNull();
        cache?.setItem('stride:test:private-draft', 'sample');

        expect(cache?.getItem('stride:test:private-draft')).toBe('sample');
        expect(window.localStorage.getItem('stride:test:private-draft')).toBe('personal');
    });
});
