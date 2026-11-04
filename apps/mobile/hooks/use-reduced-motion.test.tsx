import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReducedMotion } from './use-reduced-motion';

const mocked = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  isReduceMotionEnabled: vi.fn(),
  remove: vi.fn(),
  listener: null as ((enabled: boolean) => void) | null,
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: mocked.addEventListener,
    isReduceMotionEnabled: mocked.isReduceMotionEnabled,
  },
}));

let latest = false;
let tree: ReactTestRenderer | null = null;

function Harness() {
  latest = useReducedMotion();
  return React.createElement('ReducedMotionHarness', { enabled: latest });
}

describe('useReducedMotion', () => {
  beforeEach(() => {
    latest = false;
    mocked.listener = null;
    mocked.remove.mockReset();
    mocked.isReduceMotionEnabled.mockReset();
    mocked.isReduceMotionEnabled.mockResolvedValue(false);
    mocked.addEventListener.mockReset();
    mocked.addEventListener.mockImplementation((_event, listener) => {
      mocked.listener = listener;
      return { remove: mocked.remove };
    });
  });

  afterEach(() => {
    if (tree) {
      act(() => {
        tree?.unmount();
      });
    }
    tree = null;
  });

  it('reads the initial platform preference and follows later changes', async () => {
    mocked.isReduceMotionEnabled.mockResolvedValue(true);

    await act(async () => {
      tree = create(<Harness />);
    });

    expect(latest).toBe(true);
    expect(mocked.addEventListener).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));

    act(() => {
      mocked.listener?.(false);
    });

    expect(latest).toBe(false);
  });

  it('removes the platform listener when unmounted', async () => {
    await act(async () => {
      tree = create(<Harness />);
    });

    act(() => {
      tree?.unmount();
    });
    tree = null;

    expect(mocked.remove).toHaveBeenCalledTimes(1);
  });
});
