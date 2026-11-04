import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import renderer from 'react-test-renderer';
import { Text, TouchableOpacity, View } from 'react-native';

import { PersistenceFailureBannerView } from './persistence-failure-banner';

vi.mock('lucide-react-native', () => ({
  AlertTriangle: () => null,
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('SafeAreaView', props, children),
}));

vi.mock('@/contexts/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => ({
    'persistence.failureMessage': 'Your latest changes could not be saved. Keep Stride open and try again.',
    'errorBoundary.retry': 'Try again',
    'persistence.retrying': 'Saving…',
  } as Record<string, string>)[key] ?? key }),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({
    cardBg: '#fff', text: '#111', secondaryText: '#555', border: '#ddd', danger: '#c00', tint: '#06c',
  }),
}));

const failure = {
  message: 'Failed to save data: secret native detail',
  failedAt: '2026-08-09T12:00:00.000Z',
  retrying: false,
};

describe('PersistenceFailureBannerView', () => {
  it('announces a generic recoverable failure without exposing diagnostics', () => {
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<PersistenceFailureBannerView failure={failure} onRetry={vi.fn()} />);
    });

    const alert = tree.root.findAllByType(View).find((view) => view.props.accessibilityRole === 'alert');
    expect(alert?.props.accessibilityLiveRegion).toBe('assertive');
    expect(tree.root.findAllByType(Text).map((node) => node.props.children).join(' ')).toContain(
      'Your latest changes could not be saved',
    );
    expect(JSON.stringify(tree.toJSON())).not.toContain('secret native detail');
  });

  it('disables repeated retries while one is running', () => {
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(
        <PersistenceFailureBannerView failure={{ ...failure, retrying: true }} onRetry={vi.fn()} />,
      );
    });

    const retry = tree.root.findByType(TouchableOpacity);
    expect(retry.props.disabled).toBe(true);
    expect(retry.props.accessibilityState).toEqual({ busy: true, disabled: true });
  });
});
