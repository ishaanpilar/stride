import { isDiagnosticsEnabled, logInfo } from './app-log';

type TraceState = {
    id: number;
    startedAt: number;
};

type TraceExtra = Record<string, unknown>;

let activeTrace: TraceState | null = null;
let nextTraceId = 1;

const now = (): number => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
};

const formatMs = (value: number): string => value.toFixed(1);

const stringifyExtra = (extra?: TraceExtra): Record<string, string> | undefined => {
    if (!extra) return undefined;
    const entries = Object.entries(extra).flatMap(([key, value]) => {
        if (value === undefined || value === null) return [];
        return [[key, String(value)] as const];
    });
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const toErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message.trim()) return error.message.trim();
    const text = String(error ?? '').trim();
    return text || 'unknown';
};

const ensureTrace = (): TraceState => {
    if (!activeTrace) {
        activeTrace = {
            id: nextTraceId++,
            startedAt: now(),
        };
    }
    return activeTrace;
};

const writeTrace = (step: string, extra?: TraceExtra): void => {
    if (!isDiagnosticsEnabled()) return;
    const trace = ensureTrace();
    void logInfo(`[settings-open] ${step}`, {
        scope: 'settings-open',
        extra: {
            traceId: String(trace.id),
            elapsedMs: formatMs(now() - trace.startedAt),
            ...(stringifyExtra(extra) ?? {}),
        },
    });
};

export function beginSettingsOpenTrace(source: string): void {
    if (!isDiagnosticsEnabled()) return;
    activeTrace = {
        id: nextTraceId++,
        startedAt: now(),
    };
    writeTrace('navigate', { source });
}

export function markSettingsOpenTrace(step: string, extra?: TraceExtra): void {
    writeTrace(step, extra);
}

export async function measureSettingsOpenStep<T>(step: string, work: () => Promise<T>): Promise<T> {
    if (!isDiagnosticsEnabled()) {
        return work();
    }

    const trace = ensureTrace();
    const startedAt = now();
    void logInfo(`[settings-open] ${step}:start`, {
        scope: 'settings-open',
        extra: {
            traceId: String(trace.id),
            elapsedMs: formatMs(startedAt - trace.startedAt),
        },
    });

    try {
        const result = await work();
        void logInfo(`[settings-open] ${step}:done`, {
            scope: 'settings-open',
            extra: {
                traceId: String(trace.id),
                elapsedMs: formatMs(now() - trace.startedAt),
                durationMs: formatMs(now() - startedAt),
            },
        });
        return result;
    } catch (error) {
        void logInfo(`[settings-open] ${step}:error`, {
            scope: 'settings-open',
            extra: {
                traceId: String(trace.id),
                elapsedMs: formatMs(now() - trace.startedAt),
                durationMs: formatMs(now() - startedAt),
                error: toErrorMessage(error),
            },
        });
        throw error;
    }
}

export function wrapSettingsOpenImport<T>(step: string, loader: () => Promise<T>): () => Promise<T> {
    return () => measureSettingsOpenStep(step, loader);
}
