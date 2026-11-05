import { useLayoutEffect, useRef, type RefObject } from 'react';

import { MOTION_EASING, canAnimate } from '../lib/motion';

const VIEW_ENTER_KEYFRAMES: Keyframe[] = [
    { opacity: 0, transform: 'translateY(4px)' },
    { opacity: 1, transform: 'none' },
];

export function useEnterOnChange(
    ref: RefObject<HTMLElement | null>,
    changeKey: string,
    keyframes: Keyframe[] = VIEW_ENTER_KEYFRAMES,
    duration = 220,
): void {
    const previousKey = useRef(changeKey);
    useLayoutEffect(() => {
        if (previousKey.current === changeKey) return;
        previousKey.current = changeKey;
        const element = ref.current;
        if (!element || !canAnimate()) return;
        element.animate(keyframes, { duration, easing: MOTION_EASING.out });
    }, [changeKey, duration, keyframes, ref]);
}
