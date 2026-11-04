import React from 'react';
import { AppState, Text } from 'react-native';
import renderer from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLocalDayKey } from './use-local-day-key';

function DayProbe() {
  return <Text>{useLocalDayKey()}</Text>;
}

describe('useLocalDayKey', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('refreshes at local midnight and when the app becomes active', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 27, 23, 59, 59, 900));
    let onAppStateChange: ((state: string) => void) | undefined;
    vi.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
      onAppStateChange = listener as (state: string) => void;
      return { remove: vi.fn() };
    });

    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<DayProbe />);
    });
    expect(tree.root.findByType(Text).props.children).toBe('2026-6-27');

    renderer.act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(tree.root.findByType(Text).props.children).toBe('2026-6-28');

    vi.setSystemTime(new Date(2026, 6, 29, 9, 0, 0));
    renderer.act(() => {
      onAppStateChange?.('active');
    });
    expect(tree.root.findByType(Text).props.children).toBe('2026-6-29');
  });
});
