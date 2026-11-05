import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MorningBriefingCard } from './MorningBriefingCard';

const mocks = vi.hoisted(() => ({
    ensure: vi.fn(),
    dismissed: false,
    state: { tasks: [] as unknown[], projects: [] as unknown[], settings: {} as Record<string, unknown> },
}));

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({ bg: '#000', cardBg: '#111', border: '#222', text: '#fff', secondaryText: '#999', tint: '#39f' }),
}));
vi.mock('@/contexts/language-context', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }));
vi.mock('./morning-briefing-service', () => ({
    ensureBriefing: (...args: unknown[]) => mocks.ensure(...args),
    isBriefingDismissed: async () => mocks.dismissed,
    setBriefingDismissed: vi.fn(async () => undefined),
    readCachedBriefing: async () => null,
}));
vi.mock('@stride/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@stride/core')>()),
    useTaskStore: (selector: (s: typeof mocks.state) => unknown) => selector(mocks.state),
}));

const task = { id: 't1', title: 'Write report', status: 'next', dueDate: new Date().toISOString(), createdAt: '', updatedAt: '' };
const render = async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<MorningBriefingCard />); });
    return tree;
};
const texts = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(Text).map((n) => [n.props.children].flat().join(''));

describe('MorningBriefingCard', () => {
    beforeEach(() => {
        mocks.ensure.mockReset();
        mocks.dismissed = false;
        mocks.state = { tasks: [task], projects: [], settings: {} };
    });

    it('shows a plain summary and never calls AI when AI is off', async () => {
        const tree = await render();
        expect(mocks.ensure).not.toHaveBeenCalled();
        expect(texts(tree).join('|')).toContain('Write report');
    });

    it('renders the AI briefing, dropping unknown task ids', async () => {
        mocks.state.settings = { ai: { enabled: true } };
        mocks.ensure.mockResolvedValue({
            headline: 'Big day', suggestion: 'Start early',
            top: [{ taskId: 't1', why: 'due today' }, { taskId: 'ghost', why: 'nope' }], schedule: [],
        });
        const tree = await render();
        const out = texts(tree).join('|');
        expect(out).toContain('Big day');
        expect(out).toContain('1. Write report');
        expect(out).not.toContain('nope');
    });

    it('falls back to the plain summary when generation fails', async () => {
        mocks.state.settings = { ai: { enabled: true } };
        mocks.ensure.mockResolvedValue(null);
        const tree = await render();
        expect(tree.root.findByProps({ testID: 'morning-briefing-failed' })).toBeTruthy();
        expect(texts(tree).join('|')).toContain('Write report');
    });

    it('refreshes with force and can be dismissed', async () => {
        mocks.state.settings = { ai: { enabled: true } };
        mocks.ensure.mockResolvedValue(null);
        const tree = await render();
        await act(async () => { tree.root.findByProps({ testID: 'morning-briefing-refresh' }).props.onPress(); });
        expect(mocks.ensure).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }));
        await act(async () => { tree.root.findByProps({ testID: 'morning-briefing-dismiss' }).props.onPress(); });
        expect(tree.root.findAllByType(TouchableOpacity)).toHaveLength(0);
    });
});
