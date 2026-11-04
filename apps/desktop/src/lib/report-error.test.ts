import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    logError: vi.fn(),
    setError: vi.fn(),
    showToast: vi.fn(),
}));

vi.mock('@stride/core', () => ({
    useTaskStore: { getState: () => ({ setError: mocks.setError }) },
}));

vi.mock('../store/ui-store', () => ({
    useUiStore: { getState: () => ({ showToast: mocks.showToast }) },
}));

vi.mock('./app-log', () => ({ logError: mocks.logError }));

import { reportError } from './report-error';

describe('reportError', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows a localized safe message while keeping diagnostics in the log', () => {
        const error = new Error('native secret detail');

        reportError('Failed to update AI settings', error, {
            userMessage: 'Impossible d’enregistrer ce réglage.',
        });

        expect(mocks.setError).toHaveBeenCalledWith('Impossible d’enregistrer ce réglage.');
        expect(mocks.showToast).toHaveBeenCalledWith('Impossible d’enregistrer ce réglage.', 'error');
        expect(mocks.logError).toHaveBeenCalledWith(error, expect.objectContaining({
            step: 'Failed to update AI settings',
        }));
    });
});
