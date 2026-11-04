import { describe, expect, it, vi } from 'vitest';

import {
    buildFeedbackSubmissionPayload,
    isValidFeedbackEmail,
    submitFeedbackSubmission,
} from './feedback';

describe('feedback', () => {
    it('builds a trimmed one-way feedback payload', () => {
        const result = buildFeedbackSubmissionPayload({
            category: 'bug',
            message: '  Notifications did not fire  ',
            email: ' user@example.com ',
            metadata: {
                appVersion: ' 0.9.8 ',
                platform: ' desktop ',
                os: '',
            },
            diagnostics: {
                logs: 'line 1\nline 2',
            },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.payload.message).toBe('Notifications did not fire');
        expect(result.payload.email).toBe('user@example.com');
        expect(result.payload.metadata).toEqual({ appVersion: '0.9.8', platform: 'desktop' });
        expect(result.payload.diagnostics?.logs).toBe('line 1\nline 2');
    });

    it('rejects empty messages and malformed emails', () => {
        expect(buildFeedbackSubmissionPayload({ category: 'feature', message: '   ' })).toEqual({
            ok: false,
            error: 'message_required',
        });
        expect(isValidFeedbackEmail('not-an-email')).toBe(false);
    });

    // Stride has no feedback backend: submission is disabled (see FEEDBACK_SUBMISSION_ENABLED).
    it.skip('submits JSON to the configured endpoint', async () => {
        const fetcher = vi.fn(async () => new Response('{}', { status: 201 })) as unknown as typeof fetch;

        await submitFeedbackSubmission('https://feedback.example.test', {
            category: 'feature',
            message: 'I could not find review.',
        }, fetcher);

        expect(fetcher).toHaveBeenCalledWith('https://feedback.example.test', expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }));
    });
});

describe('feedback submission is disabled in Stride', () => {
    it('rejects without calling the fetcher', async () => {
        const fetcher = vi.fn();
        await expect(submitFeedbackSubmission('https://example.com/f', { category: 'bug', message: 'x' }, fetcher as never))
            .rejects.toThrow('feedback_not_configured');
        expect(fetcher).not.toHaveBeenCalled();
    });
});
