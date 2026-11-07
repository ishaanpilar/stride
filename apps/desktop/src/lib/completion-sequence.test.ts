import { act, renderHook } from '@testing-library/react';
import { COMPLETION_SETTLE_DELAY_MS, useTaskStore, type Task } from '@stride/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    COMPLETION_GONE_LINGER_MS,
    COMPLETION_TIMELINE,
    afterCompletionSequence,
    beginCompletion,
    cancelCompletion,
    getCompletionPhase,
    isCompletionActive,
    isWithinDoubleClickGuard,
    resetCompletionSequenceForTests,
} from './completion-sequence';
import {
    OCCURRENCE_ARRIVAL_MS,
    resetCompletionRetentionForTests,
    useCompletionRetention,
    useHeldOccurrenceIds,
    useOccurrenceArrived,
} from './completion-retention';
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

describe('repeating completions', () => {
    const repeating = { rule: 'weekly' as const, strategy: 'fluid' as const };
    const weekly = (id: string) => makeTask(id, { recurrence: repeating });
    const completedCopy = (task: Task, completedAt: string): Task => ({ ...task, status: 'done', completedAt });
    const nextOf = (task: Task, completedAt: string): Task => makeTask(`${task.id}-next`, {
        createdAt: completedAt, updatedAt: completedAt, recurrence: { ...repeating, seriesId: task.id },
    });
    const setStoreTasks = (tasks: Task[]) => act(() => { useTaskStore.setState({ tasks, _allTasks: tasks }); });
    const held = () => renderHook(() => useHeldOccurrenceIds()).result.current;
    const retainedIds = () => [...renderHook(() => useCompletionRetention()).result.current.retained.keys()];

    beforeEach(() => {
        vi.useFakeTimers();
        window.localStorage.clear();
        resetMotionPreferenceForTests();
        resetCompletionSequenceForTests();
        resetCompletionRetentionForTests();
        setStoreTasks([]);
    });
    afterEach(() => {
        resetCompletionSequenceForTests();
        resetCompletionRetentionForTests();
        setStoreTasks([]);
        vi.useRealTimers();
    });

    it('holds what the tick generated until the sequence ends, then forgets the done copy', () => {
        const task = weekly('a');
        setStoreTasks([task]);
        beginCompletion('a');
        const completedAt = new Date().toISOString();
        setStoreTasks([completedCopy(task, completedAt), nextOf(task, completedAt)]);
        expect([...held()]).toEqual(['a-next']);
        expect(retainedIds()).toEqual(['a']);

        act(() => { vi.advanceTimersByTime(COMPLETION_TIMELINE.gone); });
        expect([...held()]).toEqual([]);
        expect(retainedIds()).toEqual([]);
    });

    it('does not hold an open occurrence that was already there', () => {
        const task = weekly('a');
        const existing = makeTask('existing', { recurrence: { ...repeating, seriesId: 'a' } });
        setStoreTasks([task, existing]);
        beginCompletion('a');
        setStoreTasks([completedCopy(task, new Date().toISOString()), existing]);
        expect([...held()]).toEqual([]);
    });

    it('treats a bulk completion, which has no sequence, like a plain task settling', () => {
        const [a, b] = [weekly('a'), weekly('b')];
        setStoreTasks([a, b]);
        const completedAt = new Date().toISOString();
        setStoreTasks([completedCopy(a, completedAt), completedCopy(b, completedAt), nextOf(a, completedAt), nextOf(b, completedAt)]);
        expect([...held()].sort()).toEqual(['a-next', 'b-next']);
        act(() => { vi.advanceTimersByTime(COMPLETION_SETTLE_DELAY_MS + 10); });
        expect([...held()]).toEqual([]);
        expect(retainedIds()).toEqual([]);
    });

    it('releases the hold when the task is reopened, without a highlight', () => {
        const task = weekly('a');
        setStoreTasks([task]);
        beginCompletion('a');
        const completedAt = new Date().toISOString();
        const next = nextOf(task, completedAt);
        setStoreTasks([completedCopy(task, completedAt), next]);
        setStoreTasks([task, { ...next, deletedAt: completedAt }]);
        expect([...held()]).toEqual([]);
        expect(renderHook(() => useOccurrenceArrived('a-next')).result.current).toBe(false);
    });

    it('flags the new occurrence as arrived for a moment', () => {
        const task = weekly('a');
        setStoreTasks([task]);
        beginCompletion('a');
        const completedAt = new Date().toISOString();
        setStoreTasks([completedCopy(task, completedAt), nextOf(task, completedAt)]);
        const arrived = renderHook(() => useOccurrenceArrived('a-next'));
        expect(arrived.result.current).toBe(false);
        act(() => { vi.advanceTimersByTime(COMPLETION_TIMELINE.gone); });
        expect(arrived.result.current).toBe(true);
        act(() => { vi.advanceTimersByTime(OCCURRENCE_ARRIVAL_MS + 1); });
        expect(arrived.result.current).toBe(false);
    });

    it('leaves plain tasks retained', () => {
        const task = makeTask('plain');
        setStoreTasks([task]);
        beginCompletion('plain');
        setStoreTasks([completedCopy(task, new Date().toISOString())]);
        act(() => { vi.advanceTimersByTime(COMPLETION_TIMELINE.gone + COMPLETION_GONE_LINGER_MS + 1); });
        expect(retainedIds()).toEqual(['plain']);
    });

    it('runs what waits for the sequence at its end, and never after a cancel', () => {
        const ended = vi.fn();
        beginCompletion('a');
        afterCompletionSequence('a', ended);
        expect(ended).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(COMPLETION_TIMELINE.gone); });
        expect(ended).toHaveBeenCalledOnce();

        const cancelled = vi.fn();
        beginCompletion('b');
        afterCompletionSequence('b', cancelled);
        cancelCompletion('b');
        act(() => { vi.advanceTimersByTime(COMPLETION_TIMELINE.gone); });
        expect(cancelled).not.toHaveBeenCalled();

        const immediate = vi.fn();
        afterCompletionSequence('c', immediate);
        expect(immediate).toHaveBeenCalledOnce();
    });
});
