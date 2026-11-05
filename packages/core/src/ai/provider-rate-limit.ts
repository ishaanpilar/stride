import { waitForAIRequestRetry, type BufferedAIResponse } from './utils';

/**
 * Shared HTTP 429 handling for every AI provider: retry once, honouring Retry-After when the wait
 * is short, then fail with a clear, user-facing message instead of a raw provider error.
 */
export const RATE_LIMIT_DEFAULT_BACKOFF_MS = 2_000;
/** Never block a request longer than this on a provider's Retry-After; fail fast instead. */
export const RATE_LIMIT_MAX_WAIT_MS = 20_000;
/** Shown when the provider gives no Retry-After. */
export const RATE_LIMIT_FALLBACK_SECONDS = 30;

const QUOTA_RE = /insufficient_quota|exceeded your current quota|quota (?:has been )?exceeded|out of credits|credit balance|billing/i;

export class AIRateLimitError extends Error {
    readonly status = 429;
    readonly retryAfterSeconds: number;
    readonly quotaExhausted: boolean;

    constructor(retryAfterSeconds: number, quotaExhausted = false) {
        super(formatRateLimitMessage(retryAfterSeconds, quotaExhausted));
        this.name = 'AIRateLimitError';
        this.retryAfterSeconds = retryAfterSeconds;
        this.quotaExhausted = quotaExhausted;
    }
}

export const isAIRateLimitError = (error: unknown): error is AIRateLimitError =>
    error instanceof AIRateLimitError || (error instanceof Error && error.name === 'AIRateLimitError');

export function formatRateLimitMessage(retryAfterSeconds: number, quotaExhausted = false): string {
    if (quotaExhausted) {
        return 'Your AI provider says this API key is out of quota or credits. Check your plan or billing with the provider.';
    }
    return `Your AI provider is rate-limiting requests. Try again in ${Math.max(1, Math.ceil(retryAfterSeconds))} s.`;
}

/** Retry-After as milliseconds: `retry-after-ms`, `retry-after` seconds, or an HTTP date. Null when absent/invalid. */
export function parseRetryAfterMs(headers: Pick<Headers, 'get'> | null | undefined, now: number = Date.now()): number | null {
    if (!headers || typeof headers.get !== 'function') return null;
    const ms = headers.get('retry-after-ms')?.trim();
    if (ms && /^\d+(?:\.\d+)?$/.test(ms)) return Math.max(0, Math.round(Number(ms)));
    const raw = headers.get('retry-after')?.trim();
    if (!raw) return null;
    if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Math.round(Number(raw) * 1000));
    const date = Date.parse(raw);
    return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export const isQuotaExhaustedBody = (bodyText: string | null | undefined): boolean => QUOTA_RE.test(String(bodyText ?? '').slice(0, 2_000));

/**
 * Call for a 429 response. Waits and returns when one retry is allowed; otherwise throws
 * AIRateLimitError. A used-up quota is never retried.
 */
export async function handleRateLimitedResponse(
    response: Pick<BufferedAIResponse, 'headers' | 'bodyText'>,
    options: { canRetry: boolean; signal?: AbortSignal; label: string },
): Promise<void> {
    const retryAfterMs = parseRetryAfterMs(response.headers);
    const quota = isQuotaExhaustedBody(response.bodyText);
    const waitMs = retryAfterMs ?? RATE_LIMIT_DEFAULT_BACKOFF_MS;
    if (!options.canRetry || quota || waitMs > RATE_LIMIT_MAX_WAIT_MS) {
        const seconds = retryAfterMs !== null && retryAfterMs > 0 ? retryAfterMs / 1000 : RATE_LIMIT_FALLBACK_SECONDS;
        throw new AIRateLimitError(seconds, quota);
    }
    await waitForAIRequestRetry(waitMs, options.signal, options.label);
}
