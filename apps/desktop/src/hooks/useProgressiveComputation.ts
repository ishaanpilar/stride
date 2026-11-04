import { useEffect, useMemo, useState } from 'react';
import type { DependencyList } from 'react';

const scheduleLowPriority = (callback: () => void) => {
    if (typeof window === 'undefined') {
        const id = setTimeout(callback, 0);
        return () => clearTimeout(id);
    }

    const idleCallback = (window as typeof window & {
        requestIdleCallback?: (cb: () => void) => number;
        cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;

    if (idleCallback) {
        const id = idleCallback(callback);
        return () => {
            (window as typeof window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
        };
    }

    const id = window.setTimeout(callback, 100);
    return () => window.clearTimeout(id);
};

const scheduleHighPriority = (callback: () => void) => {
    const id = setTimeout(callback, 0);
    return () => clearTimeout(id);
};

export function useProgressiveComputation<T>(
    computation: () => T,
    dependencies: DependencyList,
    fallbackValue: T,
    priority: 'high' | 'low' = 'low',
): T {
    const [isReady, setIsReady] = useState(priority === 'high');

    useEffect(() => {
        if (isReady) return;
        const cleanup = priority === 'high'
            ? scheduleHighPriority(() => setIsReady(true))
            : scheduleLowPriority(() => setIsReady(true));
        return cleanup;
    }, [isReady, priority]);

    return useMemo(() => {
        if (!isReady) return fallbackValue;
        return computation();
    }, [isReady, ...dependencies]);
}
