import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { MindSweepProposal } from '@stride/core';
import { AiCaptureScreen } from './ai-capture-screen';

const toast = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('../../contexts/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('@/contexts/toast-context', () => ({ useToast: () => toast }));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: any) => React.createElement('SafeAreaView', props, props.children),
}));
vi.mock('@/hooks/use-theme-colors', () => {
  const colors = {
    bg: '#fff', cardBg: '#fff', border: '#ccc', text: '#000', secondaryText: '#666', tint: '#36f', onTint: '#fff',
    danger: '#f00', warning: '#fa0', inputBg: '#eee', filterBg: '#eee', success: '#0a0',
  };
  return { useThemeColors: () => colors };
});
vi.mock('./ai-capture-services', () => ({ mobileAiCaptureApi: {} }));

const byTestId = (root: ReactTestInstance, testID: string) => root.findAll((n) => typeof n.type === 'string' && n.props.testID === testID);

const proposal: MindSweepProposal = {
  projects: [], summary: 'ok', source: 'ai',
  items: [
    { key: 'a', title: 'Email Sam', kind: 'next' },
    { key: 'b', title: 'Buy milk', kind: 'inbox' },
  ],
};

const setup = async (generate: any) => {
  const api = {
    generate,
    apply: vi.fn(async () => ({ projectIds: [], taskIds: ['t1'], failed: [] })),
    undo: vi.fn(async () => true),
  };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<AiCaptureScreen onClose={() => undefined} api={api as never} />); });
  await act(async () => { byTestId(tree.root, 'ai-capture-input')[0].props.onChangeText('email sam\nbuy milk'); });
  await act(async () => { byTestId(tree.root, 'ai-capture-organise')[0].props.onPress(); });
  return { tree, api };
};

describe('AiCaptureScreen', () => {
  it('lets the user untick and edit, adds only the kept items, and undoes from the toast', async () => {
    const { tree, api } = await setup(vi.fn(async () => proposal));
    expect(byTestId(tree.root, 'ai-capture-row')).toHaveLength(2);
    await act(async () => { byTestId(tree.root, 'ai-capture-check')[1].props.onPress(); });
    await act(async () => { byTestId(tree.root, 'ai-capture-title')[0].props.onChangeText('Email Sam today'); });
    await act(async () => { await byTestId(tree.root, 'ai-capture-add')[0].props.onPress(); });

    expect(api.apply).toHaveBeenCalledTimes(1);
    const sent = (api.apply.mock.calls[0] as unknown as [{ items: { title: string }[] }])[0];
    expect(sent.items.map((i) => i.title)).toEqual(['Email Sam today']);

    const call = toast.showToast.mock.calls.at(-1)![0];
    expect(call.actionLabel).toBe('Undo');
    await act(async () => { await call.onAction(); });
    expect(api.undo).toHaveBeenCalledWith({ projectIds: [], taskIds: ['t1'], failed: [] });
  });

  it('shows the fallback notice (line-per-item) when AI output is unusable', async () => {
    const fallback: MindSweepProposal = {
      ...proposal, source: 'fallback', fallbackReason: 'failed',
      items: [{ key: 'x', title: 'raw line', kind: 'inbox' }],
    };
    const { tree } = await setup(vi.fn(async () => fallback));
    expect(byTestId(tree.root, 'ai-capture-fallback')).toHaveLength(1);
    expect(byTestId(tree.root, 'ai-capture-row')).toHaveLength(1);
  });

  it('falls back to an empty fallback proposal if generate throws', async () => {
    const { tree } = await setup(vi.fn(async () => { throw new Error('boom'); }));
    expect(byTestId(tree.root, 'ai-capture-fallback')).toHaveLength(1);
    expect(byTestId(tree.root, 'ai-capture-add')[0].props.disabled).toBe(true);
  });
});
