import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMotionPreference, MOTION_STORAGE_KEY, resetMotionPreferenceForTests, setMotionPreference } from './motion-preference';

const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

describe('motion preference', () => {
  beforeEach(() => {
    resetMotionPreferenceForTests();
    storage.getItem.mockReset();
    storage.setItem.mockReset();
    storage.setItem.mockResolvedValue(undefined);
  });

  it('defaults to on', () => {
    expect(getMotionPreference()).toBe('on');
  });

  it('updates immediately and persists', () => {
    setMotionPreference('off');
    expect(getMotionPreference()).toBe('off');
    expect(storage.setItem).toHaveBeenCalledWith(MOTION_STORAGE_KEY, 'off');
  });
});
