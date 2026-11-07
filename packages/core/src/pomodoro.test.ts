import { describe, expect, it } from 'vitest';

import {
    advancePomodoroState,
    createPomodoroCustomPreset,
    finishPomodoroOvertime,
    formatPomodoroOvertime,
    getPomodoroOvertimeProgress,
    isPomodoroInOvertime,
    POMODORO_OVERTIME_CAP_MINUTES,
    togglePomodoroRunning,
    extendPomodoroPhase,
    adjustPomodoroPhase,
    canAdjustPomodoroPhase,
    isPomodoroPhaseIdle,
    setPomodoroPhaseTotal,
    POMODORO_ADJUST_STEP_MINUTES,
    POMODORO_MAX_PHASE_MINUTES,
    getPomodoroExtensionRoomSeconds,
    getPomodoroFocusCreditMinutes,
    getPomodoroPhaseTotalSeconds,
    normalizePomodoroExtendMinutes,
    POMODORO_MAX_EXTENSION_MINUTES,
    resetPomodoroState,
    resumePomodoroFocus,
    createPomodoroState,
    DEFAULT_POMODORO_DURATIONS,
    formatPomodoroClock,
    getPomodoroPresetOptions,
    getPomodoroPhaseSeconds,
    getPomodoroFocusSessionsCompletedToday,
    recordPomodoroFocusSessions,
    sanitizePomodoroDurations,
    sanitizePomodoroSessionHistory,
    tickPomodoroState,
    POMODORO_PRESETS,
    type PomodoroAutoStartOptions,
    type PomodoroDurations,
    type PomodoroEvent,
    type PomodoroState,
} from './pomodoro';


const advanceByTicks = (
    state: PomodoroState,
    durations: PomodoroDurations,
    elapsedSeconds: number,
    options: PomodoroAutoStartOptions,
) => {
    let nextState = state;
    let lastEvent: PomodoroEvent | null = null;
    for (let i = 0; i < Math.max(0, Math.floor(elapsedSeconds)); i += 1) {
        const next = tickPomodoroState(nextState, durations, options);
        nextState = next.state;
        if (next.switchedPhase) {
            lastEvent = next.completedFocusSession ? 'focus-finished' : 'break-finished';
        }
        if (!nextState.isRunning) break;
    }
    return { state: nextState, lastEvent };
};

describe('pomodoro helpers', () => {
    it('sanitizes durations into a safe range', () => {
        expect(sanitizePomodoroDurations({ focusMinutes: -2, breakMinutes: 500 })).toEqual({
            focusMinutes: 1,
            breakMinutes: 180,
        });
    });

    it('creates default focus state', () => {
        expect(createPomodoroState()).toEqual({
            phase: 'focus',
            remainingSeconds: DEFAULT_POMODORO_DURATIONS.focusMinutes * 60,
            isRunning: false,
            completedFocusSessions: 0,
        });
    });

    it('adds one custom preset when the saved duration differs from the built-in presets', () => {
        expect(createPomodoroCustomPreset({ focusMinutes: 30, breakMinutes: 6 })).toEqual({
            id: 'custom',
            label: '30/6',
            focusMinutes: 30,
            breakMinutes: 6,
        });
        expect(getPomodoroPresetOptions({ focusMinutes: 30, breakMinutes: 6 })).toHaveLength(4);
    });

    it('reuses built-in presets when custom durations match them', () => {
        expect(createPomodoroCustomPreset({ focusMinutes: 25, breakMinutes: 5 })).toBeNull();
        expect(getPomodoroPresetOptions({ focusMinutes: 25, breakMinutes: 5 })).toHaveLength(3);
    });

    it('switches from focus to break and increments completed session', () => {
        const state = {
            phase: 'focus' as const,
            remainingSeconds: 1,
            isRunning: true,
            completedFocusSessions: 2,
        };
        const result = tickPomodoroState(state, { focusMinutes: 25, breakMinutes: 5 });
        expect(result.switchedPhase).toBe(true);
        expect(result.completedFocusSession).toBe(true);
        expect(result.state.phase).toBe('break');
        expect(result.state.isRunning).toBe(false);
        expect(result.state.remainingSeconds).toBe(getPomodoroPhaseSeconds('break', { focusMinutes: 25, breakMinutes: 5 }));
        expect(result.state.completedFocusSessions).toBe(3);
    });

    it('auto-starts breaks when configured', () => {
        const result = tickPomodoroState({
            phase: 'focus',
            remainingSeconds: 1,
            isRunning: true,
            completedFocusSessions: 0,
        }, { focusMinutes: 25, breakMinutes: 5 }, { autoStartBreaks: true });

        expect(result.state.phase).toBe('break');
        expect(result.state.isRunning).toBe(true);
        expect(result.completedFocusSession).toBe(true);
    });

    it('advances through an auto-started next phase', () => {
        const result = advancePomodoroState({
            phase: 'focus',
            remainingSeconds: 1,
            isRunning: true,
            completedFocusSessions: 4,
        }, { focusMinutes: 25, breakMinutes: 5 }, 3, { autoStartBreaks: true });

        expect(result.lastEvent).toBe('focus-finished');
        expect(result.state).toEqual({
            phase: 'break',
            remainingSeconds: getPomodoroPhaseSeconds('break', { focusMinutes: 25, breakMinutes: 5 }) - 2,
            isRunning: true,
            completedFocusSessions: 5,
        });
    });

    it('ignores nonfinite elapsed time without completing a running phase', () => {
        const state = {
            phase: 'focus' as const,
            remainingSeconds: 3,
            isRunning: true,
            completedFocusSessions: 4,
        };


        for (const elapsedSeconds of [NaN, Infinity, -Infinity]) {
            expect(advancePomodoroState(state, DEFAULT_POMODORO_DURATIONS, elapsedSeconds)).toEqual({
                state,
                lastEvent: null,
            });
        }
    });

    it('matches iterative ticks across presets, options, partial phases and boundaries', () => {
        const durationCases = [
            ...POMODORO_PRESETS,
            { focusMinutes: 1.4, breakMinutes: -2 },
            { focusMinutes: NaN, breakMinutes: Infinity },
        ];
        for (const durations of durationCases) {
            const cycleSeconds = getPomodoroPhaseSeconds('focus', durations)
                + getPomodoroPhaseSeconds('break', durations);
            for (const phase of ['focus', 'break'] as const) {
                const phaseSeconds = getPomodoroPhaseSeconds(phase, durations);
                const nextPhaseSeconds = cycleSeconds - phaseSeconds;
                for (const remainingSeconds of [phaseSeconds, phaseSeconds + 3, phaseSeconds - 2, 2.25, 1.25, 1, 0.25, 0, -3]) {
                    const boundary = Math.max(1, Math.ceil(remainingSeconds));
                    const elapsedCases = [
                        -1, 0, 0.9, 1, 1.9,
                        boundary - 1, boundary, boundary + 1,
                        boundary + nextPhaseSeconds - 1,
                        boundary + nextPhaseSeconds,
                        boundary + cycleSeconds,
                        boundary + cycleSeconds * 2 + 3,
                    ];
                    for (const autoStartFocus of [false, true]) {
                        for (const autoStartBreaks of [false, true]) {
                            const options = { autoStartFocus, autoStartBreaks };
                            const state = { phase, remainingSeconds, isRunning: true, completedFocusSessions: 4 };
                            for (const elapsedSeconds of elapsedCases) {
                                expect(
                                    advancePomodoroState(state, durations, elapsedSeconds, options),
                                    JSON.stringify({ durations, state, elapsedSeconds, options }),
                                ).toEqual(advanceByTicks(state, durations, elapsedSeconds, options));
                            }
                            expect(state).toEqual({ phase, remainingSeconds, isRunning: true, completedFocusSessions: 4 });
                        }
                    }
                }
            }
        }
    }, 30_000);

    it('leaves paused and nonpositive elapsed states untouched', () => {
        const state = { phase: 'break' as const, remainingSeconds: 31.25, isRunning: false, completedFocusSessions: 7 };
        for (const elapsedSeconds of [-100, 0, 0.99, 1, 100 * 365.25 * 24 * 60 * 60]) {
            const result = advancePomodoroState(state, DEFAULT_POMODORO_DURATIONS, elapsedSeconds, {
                autoStartFocus: true, autoStartBreaks: true,
            });
            expect(result.state).toBe(state);
            expect(result.lastEvent).toBeNull();
        }
    });

    it('catches up a century from a partial focus with exact count, residual and last event', () => {


        expect(advancePomodoroState({
            phase: 'focus', remainingSeconds: 7, isRunning: true, completedFocusSessions: 4,
        }, DEFAULT_POMODORO_DURATIONS, 3_155_760_008, {
            autoStartFocus: true, autoStartBreaks: true,
        })).toEqual({
            state: { phase: 'break', remainingSeconds: 299, isRunning: true, completedFocusSessions: 1_753_205 },
            lastEvent: 'focus-finished',
        });
    });

    it('ends complete cycles at the original full phase and reports the final transition', () => {
        for (const phase of ['focus', 'break'] as const) {
            expect(advancePomodoroState({
                ...createPomodoroState(DEFAULT_POMODORO_DURATIONS, phase, 4), isRunning: true,
            }, DEFAULT_POMODORO_DURATIONS, 3_155_760_000, {
                autoStartFocus: true, autoStartBreaks: true,
            })).toEqual({
                state: {
                    phase, remainingSeconds: phase === 'focus' ? 1500 : 300,
                    isRunning: true, completedFocusSessions: 1_753_204,
                },
                lastEvent: phase === 'focus' ? 'break-finished' : 'focus-finished',
            });
        }
    });

    it('preserves large integer counts where repeated plus-one increments stop changing them', () => {
        const durations = { focusMinutes: 1, breakMinutes: 1 };
        for (const completedFocusSessions of [2 ** 53 - 2, 2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2, 2 ** 54]) {
            for (const phase of ['focus', 'break'] as const) {
                const state = { phase, remainingSeconds: 1, isRunning: true, completedFocusSessions };
                const options = { autoStartFocus: true, autoStartBreaks: true };
                expect(advancePomodoroState(state, durations, 1201, options))
                    .toEqual(advanceByTicks(state, durations, 1201, options));
            }
        }
    });

    it('formats timer clock values', () => {
        expect(formatPomodoroClock(0)).toBe('00:00');
        expect(formatPomodoroClock(65)).toBe('01:05');
        expect(formatPomodoroClock(3605)).toBe('1:00:05');
    });

    it('sanitizes persisted local session history', () => {
        expect(sanitizePomodoroSessionHistory({
            totalCompletedFocusSessions: 1.2,
            completedFocusSessionsByTaskId: {
                ' task-1 ': 2.8,
                'task-2': -1,
                '': 4,
            },
        }, 5, '2026-08-17')).toEqual({
            totalCompletedFocusSessions: 5,
            completedFocusSessionsByTaskId: {
                'task-1': 2,
            },
            todayDayKey: '2026-08-17',
            completedTodayFocusSessions: 0,
        });
    });

    it('keeps the today-count within its day and zeroes it on rollover', () => {
        const stored = {
            totalCompletedFocusSessions: 9,
            completedFocusSessionsByTaskId: {},
            todayDayKey: '2026-08-17',
            completedTodayFocusSessions: 4,
        };

        const sameDay = sanitizePomodoroSessionHistory(stored, 0, '2026-08-17');
        expect(sameDay.completedTodayFocusSessions).toBe(4);
        expect(getPomodoroFocusSessionsCompletedToday(sameDay, '2026-08-17')).toBe(4);

        const nextDay = sanitizePomodoroSessionHistory(stored, 0, '2026-08-18');
        expect(nextDay.completedTodayFocusSessions).toBe(0);
        expect(nextDay.totalCompletedFocusSessions).toBe(9);

        expect(getPomodoroFocusSessionsCompletedToday(stored, '2026-08-18')).toBe(0);
    });

    it('records completed focus sessions in local task history', () => {
        const previous = {
            totalCompletedFocusSessions: 2,
            completedFocusSessionsByTaskId: {
                'task-1': 1,
            },
            todayDayKey: '2026-08-17',
            completedTodayFocusSessions: 1,
        };

        const next = recordPomodoroFocusSessions(previous, 'task-1', 2, '2026-08-17');

        expect(next).toEqual({
            totalCompletedFocusSessions: 4,
            completedFocusSessionsByTaskId: {
                'task-1': 3,
            },
            todayDayKey: '2026-08-17',
            completedTodayFocusSessions: 3,
        });
        expect(previous.totalCompletedFocusSessions).toBe(2);


        const rolled = recordPomodoroFocusSessions(previous, 'task-1', 1, '2026-08-18');
        expect(rolled.completedTodayFocusSessions).toBe(1);
        expect(rolled.totalCompletedFocusSessions).toBe(3);
    });
});

describe('adding time to a running phase', () => {
    const durations = { focusMinutes: 25, breakMinutes: 5 };

    it('extends the remaining time and the phase total without resetting, running or paused', () => {
        const running = { ...createPomodoroState(durations), isRunning: true, remainingSeconds: 600 };
        const result = extendPomodoroPhase(running, durations, 5);
        expect(result.addedSeconds).toBe(300);
        expect(result.state).toMatchObject({ phase: 'focus', isRunning: true, remainingSeconds: 900, phaseTotalSeconds: 1800, extendedSeconds: 300 });

        const paused = { ...running, isRunning: false };
        const pausedResult = extendPomodoroPhase(paused, durations, 10);
        expect(pausedResult.state).toMatchObject({ isRunning: false, remainingSeconds: 1200, phaseTotalSeconds: 2100 });
        expect(getPomodoroPhaseTotalSeconds(pausedResult.state, durations)).toBe(2100);
    });

    it('extends a break the same way', () => {
        const brk = { ...createPomodoroState(durations, 'break'), isRunning: true, remainingSeconds: 60 };
        const result = extendPomodoroPhase(brk, durations, 5);
        expect(result.state).toMatchObject({ phase: 'break', remainingSeconds: 360, phaseTotalSeconds: 600 });
    });

    it('caps the total added time per phase', () => {
        let state = { ...createPomodoroState(durations), isRunning: true };
        let added = 0;
        for (let i = 0; i < 3; i += 1) {
            const result = extendPomodoroPhase(state, durations, 50);
            state = result.state;
            added += result.addedSeconds;
        }
        expect(added).toBe(POMODORO_MAX_EXTENSION_MINUTES * 60);
        expect(getPomodoroExtensionRoomSeconds(state)).toBe(0);
        const blocked = extendPomodoroPhase(state, durations, 5);
        expect(blocked.addedSeconds).toBe(0);
        expect(blocked.state).toBe(state);
    });

    it('accepts only whole minutes from 1 to 60', () => {
        expect(normalizePomodoroExtendMinutes(0)).toBeNull();
        expect(normalizePomodoroExtendMinutes(61)).toBeNull();
        expect(normalizePomodoroExtendMinutes('abc')).toBeNull();
        expect(normalizePomodoroExtendMinutes(' 7 ')).toBe(7);
        expect(normalizePomodoroExtendMinutes(12.4)).toBe(12);
        const state = createPomodoroState(durations);
        expect(extendPomodoroPhase(state, durations, 0).state).toBe(state);
    });

    it('forgets the extension when the phase changes', () => {
        const extended = extendPomodoroPhase({ ...createPomodoroState(durations), isRunning: true, remainingSeconds: 2 }, durations, 1).state;
        const advanced = advancePomodoroState(extended, durations, extended.remainingSeconds, {});
        expect(advanced.lastEvent).toBe('focus-finished');
        expect(advanced.state.phase).toBe('break');
        expect(advanced.state.phaseTotalSeconds).toBeUndefined();
        expect(advanced.state.extendedSeconds).toBeUndefined();
        expect(resetPomodoroState(extended, durations).phaseTotalSeconds).toBeUndefined();
    });

    it('keeps the extension while counting down', () => {
        const extended = extendPomodoroPhase({ ...createPomodoroState(durations), isRunning: true }, durations, 10).state;
        const later = advancePomodoroState(extended, durations, 60, {}).state;
        expect(later.remainingSeconds).toBe(extended.remainingSeconds - 60);
        expect(later.phaseTotalSeconds).toBe(2100);
    });

    it('resumes focus after a finished session as a short phase of exactly that length', () => {
        const onBreak = { ...createPomodoroState(durations, 'break', 3), isRunning: false };
        const result = resumePomodoroFocus(onBreak, durations, 10);
        expect(result.state).toMatchObject({ phase: 'focus', isRunning: true, remainingSeconds: 600, phaseTotalSeconds: 600, completedFocusSessions: 3 });
        expect(getPomodoroFocusCreditMinutes(result.state, durations)).toBe(10);
    });

    it('resumes mid-focus by extending the current phase and running it', () => {
        const midFocus = { ...createPomodoroState(durations), isRunning: false, remainingSeconds: 400 };
        const result = resumePomodoroFocus(midFocus, durations, 5);
        expect(result.state).toMatchObject({ phase: 'focus', isRunning: true, remainingSeconds: 700, phaseTotalSeconds: 1800 });
        expect(getPomodoroFocusCreditMinutes(result.state, durations)).toBe(30);
    });
});

describe('keep going (overtime)', () => {
    const durations = { focusMinutes: 25, breakMinutes: 5 };
    const running = (extra: Partial<PomodoroState> = {}): PomodoroState => ({ ...createPomodoroState(durations), isRunning: true, ...extra });

    it('counts up from 0:00 instead of ending when the phase allows it, once', () => {
        const result = advancePomodoroState(running({ remainingSeconds: 3, keepGoing: true }), durations, 3, {});
        expect(result.lastEvent).toBe('focus-overtime');
        expect(result.state).toMatchObject({ phase: 'focus', isRunning: true, remainingSeconds: 0, overtimeSeconds: 0, completedFocusSessions: 0 });
        expect(isPomodoroInOvertime(result.state)).toBe(true);
        const later = advancePomodoroState(result.state, durations, 75, {});
        expect(later.lastEvent).toBeNull();
        expect(later.state.overtimeSeconds).toBe(75);
        expect(formatPomodoroOvertime(later.state.overtimeSeconds!)).toBe('+1:15');
        expect(getPomodoroOvertimeProgress(later.state, durations)).toBeCloseTo(75 / 1500);
    });

    it('crossing 0:00 and counting up in one catch-up gives the overtime event and the right count', () => {
        const result = advancePomodoroState(running({ remainingSeconds: 10, keepGoing: true }), durations, 70, {});
        expect(result.lastEvent).toBe('focus-overtime');
        expect(result.state.overtimeSeconds).toBe(60);
    });

    it('ends at 0:00 as before without keepGoing (setting off, or a timer-only session)', () => {
        const result = advancePomodoroState(running({ remainingSeconds: 3 }), durations, 3, {});
        expect(result.lastEvent).toBe('focus-finished');
        expect(result.state).toMatchObject({ phase: 'break', completedFocusSessions: 1 });
        expect(isPomodoroInOvertime(result.state)).toBe(false);
    });

    it('stops at the cap and finishes the session with its overtime', () => {
        const start = running({ remainingSeconds: 0, keepGoing: true, overtimeSeconds: 10 });
        const result = advancePomodoroState(start, durations, POMODORO_OVERTIME_CAP_MINUTES * 60, {});
        expect(result.lastEvent).toBe('focus-finished');
        expect(result.state).toMatchObject({ phase: 'break', isRunning: false, completedFocusSessions: 1 });
        expect(result.state.lastFocusSeconds).toBe(1500 + POMODORO_OVERTIME_CAP_MINUTES * 60);
        expect(isPomodoroInOvertime(result.state)).toBe(false);
    });

    it('pausing in overtime finishes the session; elsewhere it just pauses', () => {
        const over = running({ remainingSeconds: 0, keepGoing: true, overtimeSeconds: 300 });
        const toggled = togglePomodoroRunning(over, durations);
        expect(toggled.finished).toBe(true);
        expect(toggled.state).toMatchObject({ phase: 'break', isRunning: false, completedFocusSessions: 1, lastFocusSeconds: 1800 });
        expect(togglePomodoroRunning(running(), durations)).toMatchObject({ finished: false, state: { isRunning: false } });
        expect(finishPomodoroOvertime(running(), durations)).toEqual(running());
    });

    it('counts overtime toward the credited minutes', () => {
        expect(getPomodoroFocusCreditMinutes(running({ remainingSeconds: 0, overtimeSeconds: 600 }), durations)).toBe(35);
    });

    it('adding time during overtime goes back to a countdown and keeps the time worked', () => {
        const over = running({ remainingSeconds: 0, keepGoing: true, overtimeSeconds: 120 });
        const result = extendPomodoroPhase(over, durations, 10);
        expect(isPomodoroInOvertime(result.state)).toBe(false);
        expect(result.state).toMatchObject({ remainingSeconds: 600, phaseTotalSeconds: 1500 + 120 + 600, keepGoing: true });
    });
});

describe('set and adjust the current phase (Set timer, − / +)', () => {
    const d = DEFAULT_POMODORO_DURATIONS;
    const idle = createPomodoroState(d);
    const running = (remaining: number, patch: Partial<ReturnType<typeof createPomodoroState>> = {}) => ({ ...idle, isRunning: true, remainingSeconds: remaining, ...patch });

    it('idle: the upcoming focus gets exactly that length', () => {
        expect(isPomodoroPhaseIdle(idle, d)).toBe(true);
        const set = setPomodoroPhaseTotal(idle, d, 40 * 60);
        expect(set.state).toMatchObject({ remainingSeconds: 2400, phaseTotalSeconds: 2400, isRunning: false });
        expect(set.changedSeconds).toBe(15 * 60);
        expect(isPomodoroPhaseIdle(set.state, d)).toBe(true);
        // Back to the configured length drops the override.
        expect(setPomodoroPhaseTotal(set.state, d, 25 * 60).state.phaseTotalSeconds).toBeUndefined();
    });

    it('running or paused: worked time stays, the rest becomes the new remainder (at least a minute)', () => {
        // 10 min worked of 25.
        const longer = setPomodoroPhaseTotal(running(900), d, 40 * 60);
        expect(longer.state).toMatchObject({ remainingSeconds: 1800, phaseTotalSeconds: 2400, isRunning: true });
        const shorter = setPomodoroPhaseTotal({ ...running(900), isRunning: false }, d, 15 * 60);
        expect(shorter.state).toMatchObject({ remainingSeconds: 300, phaseTotalSeconds: 900, isRunning: false });
        expect(shorter.changedSeconds).toBe(-600);
        // Shorter than what is already worked: one minute is left.
        const floor = setPomodoroPhaseTotal(running(900), d, 5 * 60);
        expect(floor.state).toMatchObject({ remainingSeconds: 60, phaseTotalSeconds: 660 });
        // Bounded to 180 min; junk is ignored.
        expect(setPomodoroPhaseTotal(idle, d, 999 * 60).state.remainingSeconds).toBe(POMODORO_MAX_PHASE_MINUTES * 60);
        expect(setPomodoroPhaseTotal(idle, d, Number.NaN)).toEqual({ state: idle, changedSeconds: 0 });
    });

    it('overtime turns back into a countdown', () => {
        const over = running(0, { overtimeSeconds: 120, keepGoing: true });
        const set = setPomodoroPhaseTotal(over, d, 40 * 60);
        expect(isPomodoroInOvertime(set.state)).toBe(false);
        expect(set.state).toMatchObject({ remainingSeconds: 40 * 60 - (25 * 60 + 120), phaseTotalSeconds: 2400 });
    });

    it('± 5 min: bounds, both phases, overtime', () => {
        const step = POMODORO_ADJUST_STEP_MINUTES;
        expect(adjustPomodoroPhase(idle, d, step).state).toMatchObject({ remainingSeconds: 1800, phaseTotalSeconds: 1800 });
        expect(adjustPomodoroPhase(idle, d, -step).state).toMatchObject({ remainingSeconds: 1200, phaseTotalSeconds: 1200 });
        // Running, 3 min left: − leaves one minute, then is disabled.
        const low = adjustPomodoroPhase(running(180), d, -step);
        expect(low.state.remainingSeconds).toBe(60);
        expect(low.changedSeconds).toBe(-120);
        expect(canAdjustPomodoroPhase(low.state, d, -step)).toBe(false);
        expect(adjustPomodoroPhase(low.state, d, -step).changedSeconds).toBe(0);
        // + stops at 180 min in all.
        const near = { ...idle, remainingSeconds: 178 * 60, phaseTotalSeconds: 178 * 60 };
        expect(adjustPomodoroPhase(near, d, step).state.phaseTotalSeconds).toBe(180 * 60);
        const max = { ...idle, remainingSeconds: 180 * 60, phaseTotalSeconds: 180 * 60 };
        expect(canAdjustPomodoroPhase(max, d, step)).toBe(false);
        expect(adjustPomodoroPhase(max, d, step).changedSeconds).toBe(0);
        // Break phase works too.
        const brk = { ...createPomodoroState(d, 'break'), isRunning: true, remainingSeconds: 200 };
        expect(adjustPomodoroPhase(brk, d, step).state).toMatchObject({ phase: 'break', remainingSeconds: 500, phaseTotalSeconds: 600 });
        // Overtime: + becomes 5 more planned minutes, − is disabled.
        const over = running(0, { overtimeSeconds: 90, keepGoing: true });
        expect(canAdjustPomodoroPhase(over, d, -step)).toBe(false);
        const plus = adjustPomodoroPhase(over, d, step);
        expect(isPomodoroInOvertime(plus.state)).toBe(false);
        expect(plus.state).toMatchObject({ remainingSeconds: 300, phaseTotalSeconds: 25 * 60 + 90 + 300, isRunning: true });
        expect(plus.changedSeconds).toBe(300);
        // The new length survives ticking to the end of the phase.
        expect(tickPomodoroState({ ...plus.state, remainingSeconds: 1 }, d).state.phase).toBe('focus');
    });
});
