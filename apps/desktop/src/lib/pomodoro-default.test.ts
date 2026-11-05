import { beforeEach, describe, expect, it } from 'vitest';
import { useTaskStore } from '@stride/core';
import { enablePomodoroByDefault } from './pomodoro-default';

describe('enablePomodoroByDefault', () => {
    beforeEach(() => {
        useTaskStore.setState({ settings: {} } as never);
    });

    it('turns Pomodoro on when the user never chose', async () => {
        let saved: unknown;
        useTaskStore.setState({ settings: { features: { priorities: true } }, updateSettings: async (u: unknown) => { saved = u; } } as never);
        expect(await enablePomodoroByDefault()).toBe(true);
        expect(saved).toEqual({ features: { priorities: true, pomodoro: true } });
    });

    it('never overrides an explicit choice', async () => {
        let calls = 0;
        const updateSettings = async () => { calls += 1; };
        useTaskStore.setState({ settings: { features: { pomodoro: false } }, updateSettings } as never);
        expect(await enablePomodoroByDefault()).toBe(false);
        useTaskStore.setState({ settings: { features: { pomodoro: true } }, updateSettings } as never);
        expect(await enablePomodoroByDefault()).toBe(false);
        expect(calls).toBe(0);
    });
});
