import { describe, expect, it } from 'vitest';

import { findAttachmentsSection, getRecurrenceRRuleValue, normalizeDateInputValue, toDateTimeLocalValue } from './task-item-helpers';

describe('normalizeDateInputValue', () => {
    const referenceNow = new Date('2026-02-24T12:00:00.000Z');

    it('keeps fully specified dates unchanged', () => {
        expect(normalizeDateInputValue('2026-03-05', referenceNow)).toBe('2026-03-05');
    });

    it('fills blank year/month/day segments from current date', () => {
        expect(normalizeDateInputValue('0000-00-15', referenceNow)).toBe('2026-02-15');
        expect(normalizeDateInputValue('2027-00-00', referenceNow)).toBe('2027-02-24');
    });

    it('clamps overflow day after filling blanks', () => {
        expect(normalizeDateInputValue('0000-02-31', referenceNow)).toBe('2026-02-28');
    });

    it('returns non-date input unchanged', () => {
        expect(normalizeDateInputValue('not-a-date', referenceNow)).toBe('not-a-date');
    });
});

describe('findAttachmentsSection', () => {
    it('finds attachments wherever the user reassigned the field', () => {
        expect(findAttachmentsSection(['attachments'], [], [])).toBe('scheduling');
        expect(findAttachmentsSection([], ['attachments'], [])).toBe('organization');
        expect(findAttachmentsSection([], [], ['attachments'])).toBe('details');
    });

    it('returns null when attachments is in the basic section or hidden', () => {
        expect(findAttachmentsSection([], [], [])).toBeNull();
    });
});

describe('getRecurrenceRRuleValue', () => {
    it('builds monthly BYMONTHDAY rules from explicit recurrence metadata', () => {
        expect(getRecurrenceRRuleValue({
            rule: 'monthly',
            strategy: 'strict',
            byMonthDay: [9],
        })).toBe('FREQ=MONTHLY;BYMONTHDAY=9');
    });
});

describe('toDateTimeLocalValue', () => {
    it('renders a date-only value as date-only, not with an implicit T00:00 (project reviewAt, #cheap-cuts)', () => {
        expect(toDateTimeLocalValue('2025-06-01')).toBe('2025-06-01');
    });

    it('renders a value with an explicit time as a datetime-local string', () => {
        expect(toDateTimeLocalValue('2025-06-01T09:30')).toBe('2025-06-01T09:30');
    });

    it('returns an empty string for an empty/undefined value', () => {
        expect(toDateTimeLocalValue(undefined)).toBe('');
        expect(toDateTimeLocalValue('')).toBe('');
    });
});
