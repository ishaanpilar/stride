import { useCallback, useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useReducedMotion } from '../hooks/use-reduced-motion';

export type MotionPreference = 'on' | 'off';

export const MOTION_STORAGE_KEY = '@stride_animations';

let currentPreference: MotionPreference = 'on';
let loadStarted = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => currentPreference;

async function loadStoredPreference(): Promise<void> {
  if (loadStarted) return;
  loadStarted = true;
  try {
    const stored = await AsyncStorage.getItem(MOTION_STORAGE_KEY);
    if (stored === 'on' || stored === 'off') {
      currentPreference = stored;
      emit();
    }
  } catch {
    loadStarted = false;
  }
}

/** Loads the stored preference early (call once at app start) so the first screen already has it. */
export function preloadMotionPreference(): Promise<void> {
  return loadStoredPreference();
}

export function setMotionPreference(preference: MotionPreference): void {
  currentPreference = preference;
  loadStarted = true;
  emit();
  void AsyncStorage.setItem(MOTION_STORAGE_KEY, preference).catch(() => undefined);
}

export function getMotionPreference(): MotionPreference {
  return currentPreference;
}

export function resetMotionPreferenceForTests(): void {
  currentPreference = 'on';
  loadStarted = false;
  listeners.clear();
}

export function useMotionPreference(): [MotionPreference, (preference: MotionPreference) => void] {
  const preference = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void loadStoredPreference();
  }, []);
  const update = useCallback((next: MotionPreference) => setMotionPreference(next), []);
  return [preference, update];
}

export function useMotionEnabled(): boolean {
  const [preference] = useMotionPreference();
  const reducedMotion = useReducedMotion();
  return preference === 'on' && !reducedMotion;
}
