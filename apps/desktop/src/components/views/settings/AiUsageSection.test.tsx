import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AI_USAGE_LIMIT_STORAGE_KEY, AI_USAGE_STORAGE_KEY } from '@stride/core';
import { consumeAiUsage } from '../../../lib/ai-usage';
import { AiUsageSection } from './AiUsageSection';

describe('AiUsageSection', () => {
    afterEach(() => {
        localStorage.removeItem(AI_USAGE_STORAGE_KEY);
        localStorage.removeItem(AI_USAGE_LIMIT_STORAGE_KEY);
    });

    it("shows today's usage and updates live", () => {
        consumeAiUsage('assistant');
        consumeAiUsage('capture');
        render(<AiUsageSection />);
        expect(screen.getByTestId('ai-usage-today').textContent).toBe('Today: 2 AI requests, 1 from the Assistant.');
        act(() => { consumeAiUsage('assistant'); });
        expect(screen.getByTestId('ai-usage-today').textContent).toBe('Today: 3 AI requests, 2 from the Assistant.');
    });

    it('defaults the daily Assistant limit to 300 and offers Unlimited', () => {
        render(<AiUsageSection />);
        const select = screen.getByLabelText('Daily Assistant limit') as HTMLSelectElement;
        expect(select.value).toBe('300');
        expect([...select.options].map((o) => o.textContent)).toEqual(['100 a day', '300 a day', '1000 a day', 'Unlimited']);
        fireEvent.change(select, { target: { value: 'unlimited' } });
        expect(JSON.parse(localStorage.getItem(AI_USAGE_LIMIT_STORAGE_KEY)!)).toEqual({ assistantDailyLimit: null });
        expect(select.value).toBe('unlimited');
    });

    it('blocks the Assistant once the daily limit is reached', () => {
        localStorage.setItem(AI_USAGE_LIMIT_STORAGE_KEY, JSON.stringify({ assistantDailyLimit: 2 }));
        expect(consumeAiUsage('assistant').allowed).toBe(true);
        expect(consumeAiUsage('assistant').allowed).toBe(true);
        expect(consumeAiUsage('assistant')).toMatchObject({ allowed: false, reason: 'daily', limit: 2 });
    });
});
