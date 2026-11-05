import { useCallback, useRef } from 'react';
import { Animated } from 'react-native';
import { useMotionEnabled } from '../../lib/motion-preference';

const PRESS_SCALE = 0.98;
const PRESS_DURATION_MS = 120;

export function usePressScale() {
  const motionEnabled = useMotionEnabled();
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = useCallback((toValue: number) => {
    if (!motionEnabled) return;
    Animated.timing(scale, { toValue, duration: PRESS_DURATION_MS, useNativeDriver: true }).start();
  }, [motionEnabled, scale]);

  const onPressIn = useCallback(() => animateTo(PRESS_SCALE), [animateTo]);
  const onPressOut = useCallback(() => animateTo(1), [animateTo]);

  return { scaleStyle: { transform: [{ scale }] }, onPressIn, onPressOut, motionEnabled };
}
