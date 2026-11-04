import React from 'react';
import renderer from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { TaskStatusBadge } from './task-status-badge';

vi.mock('../contexts/language-context', () => ({
    useLanguage: () => ({
        t: (key: string) => ({
            'status.done': 'Done',
            'status.next': 'Next',
            'taskEdit.statusLabel': 'Status',
            'task.completeBackdateHintMobile': 'Long-press to complete with a different time',
        }[key] ?? key),
    }),
}));

vi.mock('../hooks/use-status-colors', () => ({
    useStatusColors: () => ({
        inbox: { bg: '#111827', border: '#6b7280', text: '#e5e7eb' },
        done: { bg: '#064e3b', border: '#10b981', text: '#d1fae5' },
        next: { bg: '#1e3a8a', border: '#3b82f6', text: '#dbeafe' },
        waiting: { bg: '#78350f', border: '#f59e0b', text: '#fef3c7' },
        someday: { bg: '#4c1d95', border: '#8b5cf6', text: '#ede9fe' },
        reference: { bg: '#164e63', border: '#06b6d4', text: '#cffafe' },
    }),
}));

vi.mock('../hooks/use-theme-colors', () => ({
    resolveThemeColors: () => ({
        cardBg: '#111111',
        border: '#333333',
        text: '#ffffff',
        secondaryText: '#aaaaaa',
        filterBg: '#222222',
    }),
}));

describe('TaskStatusBadge', () => {
    it('adjusts the completion timestamp when the Done badge is long-pressed', () => {
        const onBackdatedComplete = vi.fn();
        let tree!: renderer.ReactTestRenderer;

        renderer.act(() => {
            tree = renderer.create(
                <TaskStatusBadge
                    status="done"
                    onUpdate={vi.fn()}
                    onBackdatedComplete={onBackdatedComplete}
                />
            );
        });

        const badge = tree.root.findByProps({ accessibilityLabel: 'Status: Done' });
        expect(badge.props.accessibilityHint).toBe('Long-press to complete with a different time');

        renderer.act(() => {
            badge.props.onLongPress();
        });

        expect(onBackdatedComplete).toHaveBeenCalledTimes(1);
    });

    it('keeps long-press completion off non-Done badges', () => {
        let tree!: renderer.ReactTestRenderer;

        renderer.act(() => {
            tree = renderer.create(
                <TaskStatusBadge
                    status="next"
                    onUpdate={vi.fn()}
                    onBackdatedComplete={vi.fn()}
                />
            );
        });

        const badge = tree.root.findByProps({ accessibilityLabel: 'Status: Next' });
        expect(badge.props.onLongPress).toBeUndefined();
        expect(badge.props.accessibilityHint).toBeUndefined();
    });
});
