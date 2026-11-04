import { useMemo } from 'react';
import type { DependencyList } from 'react';

export function useConditionalMemo<T>(
    condition: boolean,
    computation: () => T,
    dependencies: DependencyList,
    fallbackValue: T,
): T {
    return useMemo(() => {
        if (!condition) return fallbackValue;
        return computation();
    }, [condition, ...dependencies]);
}
