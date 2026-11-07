import { describe, expect, it, vi } from 'vitest';
import { createFocusAiService, createFocusCoachStore, markFocusTaskDone, type FocusKeyValueStorage } from './focus-coach-service';
import { computeFocusStreak, createFocusStreakStore } from './focus-streak';
import { useTaskStore } from './store';
import type { Task } from './types';

const input = { title: 'Write the report', context: {} };

const memoryStorage = (): FocusKeyValueStorage => {
    const values = new Map<string, string>();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
        removeItem: (key) => { values.delete(key); },
    };
};

describe('createFocusAiService', () => {
    it('falls back when no provider is available', async () => {
        const service = createFocusAiService(async () => null);
        const coach = await service.requestFocusCoach('k', input);
        expect(coach.source).toBe('fallback');
        const reply = await service.requestFocusCoachReply(input, [{ role: 'user', text: 'waiting on Sam' }]);
        expect(reply.source).toBe('fallback');
        expect(await service.requestFocusEncouragement('e', { taskTitle: 't', milestone: 'half', done: 1, total: 2 })).toBeNull();
    });

    it('falls back when resolving the provider throws', async () => {
        const service = createFocusAiService(async () => { throw new Error('no key'); });
        expect((await service.requestFocusCoach('k', input)).source).toBe('fallback');
    });

    it('falls back when the provider rejects or returns junk', async () => {
        const failing = createFocusAiService(async () => ({ generateText: vi.fn().mockRejectedValue(new Error('boom')) }));
        expect((await failing.requestFocusCoach('k1', input)).source).toBe('fallback');
        const junk = createFocusAiService(async () => ({ generateText: vi.fn().mockResolvedValue('not json') }));
        expect((await junk.requestFocusCoach('k2', input)).source).toBe('fallback');
    });
});

describe('createFocusCoachStore', () => {
    it('round-trips the now line and survives missing storage', () => {
        const store = createFocusCoachStore(memoryStorage);
        const shared = memoryStorage();
        const live = createFocusCoachStore(() => shared);
        live.writeFocusNow('t1', 'First step');
        expect(live.readFocusNow('t1')).toBe('First step');
        expect(live.readFocusNow('t2')).toBeNull();
        live.writeFocusNow('t1', null);
        expect(live.readFocusNow('t1')).toBeNull();
        const none = createFocusCoachStore(() => null);
        expect(none.readFocusCoachFeedback()).toEqual([]);
        expect(store.readFocusCoachFeedbackSummary()).toEqual([]);
    });

    it('records feedback entries', () => {
        const shared = memoryStorage();
        const store = createFocusCoachStore(() => shared);
        store.recordFocusCoachFeedback({ taskId: 'a', taskTitle: 'A', kind: 'coach', verdict: 'useful', at: new Date().toISOString(), digital: false });
        expect(store.readFocusCoachFeedback()).toHaveLength(1);
    });
});

describe('markFocusTaskDone', () => {
    it('Undo on a repeating task also takes back the occurrence the completion created', async () => {
        const task: Task = {
            id: 'r1', title: 'Call Brian', status: 'next', tags: [], contexts: [], isFocusedToday: true, dueDate: '2030-01-07',
            recurrence: { rule: 'weekly', strategy: 'fluid' }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        };
        useTaskStore.setState({ tasks: [task], _allTasks: [task], projects: [], _allProjects: [], areas: [], _allAreas: [], settings: { deviceId: 'd' } });
        const open = () => useTaskStore.getState()._allTasks.filter((t) => t.status !== 'done' && !t.deletedAt);
        const undo = await markFocusTaskDone('r1');
        expect(open().map((t) => t.id)).not.toContain('r1');
        expect(open()).toHaveLength(1);
        expect(await undo!.undo()).toBe(true);
        expect(open().map((t) => t.id)).toEqual(['r1']);
        expect(useTaskStore.getState()._allTasks.find((t) => t.id === 'r1')?.isFocusedToday).toBe(true);
    });
});

describe('focus streak', () => {
    it('counts consecutive days ending today or yesterday', () => {
        expect(computeFocusStreak(['2026-11-03', '2026-11-04', '2026-11-05'], '2026-11-05')).toBe(3);
        expect(computeFocusStreak(['2026-11-03', '2026-11-04'], '2026-11-05')).toBe(2);
        expect(computeFocusStreak(['2026-11-01'], '2026-11-05')).toBe(0);
    });

    it('records a day once', () => {
        const shared = memoryStorage();
        const store = createFocusStreakStore(() => shared);
        const day = new Date(2026, 10, 5, 12);
        expect(store.recordFocusDay(day)).toBe(1);
        expect(store.recordFocusDay(day)).toBe(1);
        expect(store.getFocusStreak(day)).toBe(1);
    });
});
