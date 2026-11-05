import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore } from '@stride/core';

import { captureLinesToInbox, splitCaptureLines } from './inline-capture';
import { CAPTURE_PREFERENCES_STORAGE_KEY, getCapturePreferences, resetCapturePreferencesForTests, setCapturePreferences } from './capture-preferences';

describe('splitCaptureLines', () => {
    it('splits pasted text into one item per line and drops bullets and blanks', () => {
        expect(splitCaptureLines('  milk \r\n- eggs\n\n* bread\n1. jam\n[ ] tea\n')).toEqual(['milk', 'eggs', 'bread', 'jam', 'tea']);
        expect(splitCaptureLines('   \n  ')).toEqual([]);
    });
});

describe('captureLinesToInbox', () => {
    beforeEach(() => {
        useTaskStore.setState({ tasks: [], projects: [], areas: [], people: [] } as never);
    });

    it('adds every line to the Inbox', async () => {
        const addTask = vi.fn(async () => ({ success: true, id: `id-${addTask.mock.calls.length}` }));
        useTaskStore.setState({ addTask } as never);
        const result = await captureLinesToInbox('Call dentist\nBuy milk');
        expect(result.saved).toBe(2);
        expect(addTask).toHaveBeenCalledTimes(2);
        expect(addTask.mock.calls.map((call) => (call as unknown[])[0])).toEqual(['Call dentist', 'Buy milk']);
        for (const call of addTask.mock.calls) expect((call as unknown[])[1]).toMatchObject({ status: 'inbox' });
    });

    it('counts failures without throwing', async () => {
        const addTask = vi.fn(async () => { throw new Error('disk full'); });
        useTaskStore.setState({ addTask } as never);
        await expect(captureLinesToInbox('a\nb')).resolves.toMatchObject({ saved: 0, failed: 2 });
    });
});

describe('capture preferences', () => {
    beforeEach(() => {
        localStorage.clear();
        resetCapturePreferencesForTests();
    });

    it('defaults to off and persists the auto-save toggle', () => {
        expect(getCapturePreferences().autoSaveAfterTranscription).toBe(false);
        setCapturePreferences({ autoSaveAfterTranscription: true });
        expect(JSON.parse(localStorage.getItem(CAPTURE_PREFERENCES_STORAGE_KEY)!)).toEqual({ autoSaveAfterTranscription: true });
        resetCapturePreferencesForTests();
        expect(getCapturePreferences().autoSaveAfterTranscription).toBe(true);
    });

    it('ignores corrupt stored values', () => {
        localStorage.setItem(CAPTURE_PREFERENCES_STORAGE_KEY, '{not json');
        expect(getCapturePreferences().autoSaveAfterTranscription).toBe(false);
    });
});
