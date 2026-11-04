import { describe, expect, it } from 'vitest';
import { normalizeTaskForLoad } from './task-status';
import { normalizeTaskForSyncMerge } from './sync-normalization';
import type { Task } from './types';

const base = { id: 't1', title: 'T', status: 'next', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const now = '2026-02-01T00:00:00.000Z';

describe('legacy pre-rename task fields', () => {
    it('maps suppressMindwtrReminders to suppressStrideReminders on load', () => {
        const loaded = normalizeTaskForLoad({ ...base, suppressMindwtrReminders: true } as unknown as Task, now);
        expect(loaded.suppressStrideReminders).toBe(true);
        expect(loaded).not.toHaveProperty('suppressMindwtrReminders');
    });

    it('prefers the new field when both are present', () => {
        const loaded = normalizeTaskForLoad({ ...base, suppressStrideReminders: false, suppressMindwtrReminders: true } as unknown as Task, now);
        expect(loaded.suppressStrideReminders).toBe(false);
    });

    it('maps the legacy field through sync merge normalization', () => {
        const merged = normalizeTaskForSyncMerge({ ...base, suppressMindwtrReminders: true } as unknown as Task, now);
        expect(merged.suppressStrideReminders).toBe(true);
    });
});
