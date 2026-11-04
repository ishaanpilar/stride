import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PersistenceFailureBannerView } from './PersistenceFailureBanner';
import { LanguageProvider } from '../contexts/language-context';

const failure = {
    message: 'Failed to save data: secret native detail',
    failedAt: '2026-08-09T12:00:00.000Z',
    retrying: false,
};

describe('PersistenceFailureBannerView', () => {
    it('keeps the diagnostic detail private and offers recovery', () => {
        const onRetry = vi.fn();
        const { getByRole, queryByText } = render(
            <LanguageProvider>
                <PersistenceFailureBannerView failure={failure} onRetry={onRetry} />
            </LanguageProvider>
        );

        expect(getByRole('alert')).toHaveTextContent('Your latest changes could not be saved');
        expect(queryByText(/secret native detail/i)).not.toBeInTheDocument();
        fireEvent.click(getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('disables repeated retries while one is running', () => {
        const { getByRole } = render(
            <LanguageProvider>
                <PersistenceFailureBannerView failure={{ ...failure, retrying: true }} onRetry={vi.fn()} />
            </LanguageProvider>
        );

        expect(getByRole('button', { name: 'Saving…' })).toBeDisabled();
    });
});
