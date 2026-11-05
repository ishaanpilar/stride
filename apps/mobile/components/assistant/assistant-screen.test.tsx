import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AssistantSession } from '@stride/core';
import { createFakePort, createScriptedClient, toolCall } from '../../../../packages/core/src/ai/assistant/testing';
import { AssistantScreen } from './assistant-screen';

vi.mock('../../contexts/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));
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
vi.mock('./assistant-services', () => ({
  getMobileAssistantSession: () => { throw new Error('not used'); },
  getMobileAssistantReadiness: async () => ({ ready: true }),
}));
vi.mock('@stride/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stride/core')>();
  const state = { settings: { ai: {} } };
  return { ...actual, useTaskStore: (selector: (s: any) => unknown) => selector(state) };
});

const byTestId = (root: ReactTestInstance, testID: string) => root.findAll((n) => typeof n.type === 'string' && n.props.testID === testID);

const setup = async (script: any[], readiness: any = { ready: true }, seed: any = { tasks: [{ title: 'Old' }] }) => {
  const fake = createFakePort(seed);
  const { client } = createScriptedClient(script);
  const store = new Map<string, string>();
  const session = new AssistantSession({
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); } },
    createClient: async () => client,
    createPort: () => fake.port,
  });
  const onOpenAiSettings = vi.fn();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<AssistantScreen onClose={() => undefined} onOpenAiSettings={onOpenAiSettings} controls={{ session, getReadiness: async () => readiness }} />);
  });
  return { tree, session, fake, onOpenAiSettings };
};

const type = async (tree: ReactTestRenderer, text: string) => {
  await act(async () => { byTestId(tree.root, 'assistant-input')[0].props.onChangeText(text); });
  await act(async () => { byTestId(tree.root, 'assistant-send')[0].props.onPress(); });
};

describe('AssistantScreen', () => {
  it('shows the no-provider state with a link to AI settings', async () => {
    const { tree, onOpenAiSettings } = await setup([{ content: 'x' }], { ready: false, reason: 'disabled' });
    expect(byTestId(tree.root, 'assistant-disabled')).toHaveLength(1);
    await act(async () => { byTestId(tree.root, 'assistant-open-ai-settings')[0].props.onPress(); });
    expect(onOpenAiSettings).toHaveBeenCalled();
  });

  it('asks for confirmation before deleting, then deletes and offers undo', async () => {
    const { tree, fake } = await setup([{ toolCalls: [toolCall('delete_task', { id: 'task1' })] }, { content: 'Please confirm.' }]);
    await type(tree, 'delete Old');
    expect(fake.tasks[0].deletedAt).toBeUndefined();
    expect(byTestId(tree.root, 'assistant-confirm-sheet')).toHaveLength(1);

    await act(async () => { byTestId(tree.root, 'assistant-sheet-confirm')[0].props.onPress(); });
    expect(fake.tasks[0].deletedAt).toBeDefined();
    expect(byTestId(tree.root, 'assistant-confirm-sheet')).toHaveLength(0);

    await act(async () => { byTestId(tree.root, 'assistant-undo')[0].props.onPress(); });
    expect(fake.tasks[0].deletedAt).toBeUndefined();
  });

  it('declining leaves the task alone', async () => {
    const { tree, fake } = await setup([{ toolCalls: [toolCall('delete_task', { id: 'task1' })] }, { content: 'ok' }]);
    await type(tree, 'delete Old');
    await act(async () => { byTestId(tree.root, 'assistant-sheet-decline')[0].props.onPress(); });
    expect(fake.tasks[0].deletedAt).toBeUndefined();
    expect(byTestId(tree.root, 'assistant-confirm-sheet')).toHaveLength(0);
  });

  it('shows an error bubble when the model client fails', async () => {
    const fake = createFakePort();
    const session = new AssistantSession({ storage: null, createClient: async () => { throw new Error('bad key'); }, createPort: () => fake.port });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<AssistantScreen onClose={() => undefined} onOpenAiSettings={() => undefined} controls={{ session, getReadiness: async () => ({ ready: true }) }} />);
    });
    await type(tree, 'hello');
    expect(byTestId(tree.root, 'assistant-reply').length).toBeGreaterThan(0);
    expect(session.getState().thread.messages.at(-1)?.isError).toBe(true);
  });
});
