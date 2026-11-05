import { act } from '@testing-library/react';
import { useTaskStore, type Task } from '@stride/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    COMPLETION_GONE_LINGER_MS,
    COMPLETION_TIMELINE,
    beginCompletion,
    cancelCompletion,
    getCompletionPhase,
    isCompletionActive,
    isWithinDoubleClickGuard,
    resetCompletionSequenceForTests,
} from './completion-sequence';
import { resetCompletionRetentionForTests } from './completion-retention';
import { resetCompletionSoundForTests, setCompletionSoundEnabled } from './completion-sound';
import { MOTION_STORAGE_KEY, resetMotionPreferenceForTests } from './motion';

const now = new Date().toISOString();
const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
    id, title: `Task ${id}`, status: 'next', tags: [], contexts: [], createdAt: now, updatedAt: now, ...overrides,
});

function installAudioMock() {
    const started: number[] = [];
    class FakeAudioContext {
        state = 'running';
        currentTime = 0;
        destination = {};
        resume = vi.fn().mockResolvedValue(undefined);
        suspend = vi.fn().mockResolvedValue(undefined);
        createOscillator() {
            return {
                type: 'sine',
                frequency: { setValueAtTime: vi.fn() },
                connect: vi.fn(),
                start: (at: number) => started.push(at),
                stop: vi.fn(),
            };
        }
        createGain() {
            return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
        }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    return started;
}

describe('completion sequence', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        window.localStorage.clear();
        resetMotionPreferenceForTests();
        resetCompletionSoundForTests();
        resetCompletionSequenceForTests();
    });
    afterEach(() => {
        resetCompletionSequenceForTests();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('steps popping -> struck -> holding -> leaving -> gone, then forgets the task', () => {
        expect(beginCompletion('a')).toBe(true);
        expect(getCompletionPhase('a')).toBe('popping');
        expect(isCompletionActive('a')).toBe(true);
        vi.advanceTimersByTime(COMPLETION_TIMELINE.struck);
        expect(getCompletionPhase('a')).toBe('struck');
        vi.advanceTimersByTime(COMPLETION_TIMELINE.holding - COMPLETION_TIMELINE.struck);
        expect(getCompletionPhase('a')).toBe('holding');
        vi.advanceTimersByTime(COMPLETION_TIMELINE.leaving - COMPLETION_TIMELINE.holding);
        expect(getCompletionPhase('a')).toBe('leaving');
        expect(isCompletionActive('a')).toBe(true);
        vi.advanceTimersByTime(COMPLETION_TIMELINE.gone - COMPLETION_TIMELINE.leaving);
        expect(getCompletionPhase('a')).toBe('gone');
        expect(isCompletionActive('a')).toBe(false);
        vi.advanceTimersByTime(COMPLETION_GONE_LINGER_MS);
        expect(getCompletionPhase('a')).toBeUndefined();
    });

    it('takes 1.1 to 1.4 seconds in total', () => {
        expect(COMPLETION_TIMELINE.gone).toBeGreaterThanOrEqual(1100);
        expect(COMPLETION_TIMELINE.gone).toBeLessThanOrEqual(1400);
    });

    it('ignores a second start while running (no double completion on a double click)', () => {
        expect(beginCompletion('a')).toBe(true);
        vi.advanceTimersByTime(100);
        expect(beginCompletion('a')).toBe(false);
        expect(isWithinDoubleClickGuard('a')).toBe(true);
        vi.advanceTimersByTime(COMPLETION_TIMELINE.holding);
        expect(isWithinDoubleClickGuard('a')).toBe(false);
        // The timeline was not restarted by the second click.
        vi.advanceTimersByTime(COMPLETION_TIMELINE.gone - COMPLETION_TIMELINE.holding - 100);
        expect(getCompletionPhase('a')).toBe('gone');
    });

    it('cancel stops the sequence cleanly', () => {
        beginCompletion('a');
        vi.advanceTimersByTime(COMPLETION_TIMELINE.holding + 50);
        cancelCompletion('a');
        expect(getCompletionPhase('a')).toBeUndefined();
        vi.advanceTimersByTime(2000);
        expect(getCompletionPhase('a')).toBeUndefined();
    });

    it('is immediate with Animations off', () => {
        window.localStorage.setItem(MOTION_STORAGE_KEY, 'off');
        resetMotionPreferenceForTests();
        beginCompletion('a');
        expect(getCompletionPhase('a')).toBe('gone');
        expect(isCompletionActive('a')).toBe(false);
        vi.advanceTimersByTime(0);
        expect(getCompletionPhase('a')).toBeUndefined();
    });

    it('plays the completion sound only when asked and only when the setting is on', () => {
        const started = installAudioMock();
        beginCompletion('quiet');
        expect(started).toHaveLength(0);
        beginCompletion('loud', { sound: true });
        expect(started.length).toBeGreaterThan(0);
        const before = started.length;
        setCompletionSoundEnabled(false);
        beginCompletion('muted', { sound: true });
        expect(started).toHaveLength(before);
    });
});

describe('completion sequence and the task store', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        window.localStorage.clear();
        resetMotionPreferenceForTests();
        resetCompletionRetentionForTests();
        resetCompletionSequenceForTests();
        useTaskStore.setState({ _allTasks: [makeTask('a'), makeTask('b')], tasks: [makeTask('a'), makeTask('b')] } as never);
    });
    afterEach(() => {
        resetCompletionSequenceForTests();
        vi.useRealTimers();
    });

    const setStatus = (id: string, status: Task['status']) => act(() => {
        const tasks = useTaskStore.getState()._allTasks.map((task) => (task.id === id ? { ...task, status } : task));
        useTaskStore.setState({ _allTasks: tasks, tasks } as never);
    });

    it('undo during the hold cancels the sequence', () => {
        beginCompletion('a', { sound: false });
        setStatus('a', 'done');
        vi.advanceTimersByTime(COMPLETION_TIMELINE.holding + 100);
        expect(getCompletionPhase('a')).toBe('holding');
        setStatus('a', 'next');
        expect(getCompletionPhase('a')).toBeUndefined();
        vi.advanceTimersByTime(2000);
        expect(getCompletionPhase('a')).toBeUndefined();
    });

    it('gives a completion made elsewhere (keyboard, other window) the same sequence', () => {
        setStatus('b', 'done');
        expect(getCompletionPhase('b')).toBe('popping');
    });

    it('keeps bulk completions instant', () => {
        act(() => {
            const tasks = useTaskStore.getState()._allTasks.map((task) => ({ ...task, status: 'done' as const }));
            useTaskStore.setState({ _allTasks: tasks, tasks } as never);
        });
        expect(getCompletionPhase('a')).toBeUndefined();
        expect(getCompletionPhase('b')).toBeUndefined();
    });
});
