import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { POMODORO_KEEP_GOING_STORAGE_KEY, readPomodoroKeepGoing } from '../../../lib/pomodoro-preferences';
import { PomodoroKeepGoingSettingRow } from './PomodoroKeepGoingSettingRow';

describe('PomodoroKeepGoingSettingRow', () => {
    beforeEach(() => window.localStorage.clear());

    it('is on by default and stores the choice on this device only', () => {
        const onSaved = vi.fn();
        render(<PomodoroKeepGoingSettingRow title="Keep going when the timer ends" description="Counts up past 0:00." onSaved={onSaved} />);
        const toggle = screen.getByRole('switch', { name: 'Keep going when the timer ends' });
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(toggle);
        expect(readPomodoroKeepGoing()).toBe(false);
        expect(window.localStorage.getItem(POMODORO_KEEP_GOING_STORAGE_KEY)).toBe('false');
        expect(onSaved).toHaveBeenCalled();
        expect(screen.getByRole('switch', { name: 'Keep going when the timer ends' })).toHaveAttribute('aria-checked', 'false');
    });
});
