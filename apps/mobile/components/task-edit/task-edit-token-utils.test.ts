import { describe, expect, it } from 'vitest';
import {
    getActiveTokenQuery,
    parseTokenList,
    replaceTrailingToken,
} from './task-edit-token-utils';

describe('task-edit token utils', () => {
    it('normalizes and deduplicates token lists', () => {
        expect(parseTokenList('home, @work, @home, , @work', '@')).toEqual(['@home', '@work']);
        expect(parseTokenList('urgent, #idea, #urgent', '#')).toEqual(['#urgent', '#idea']);
    });

    it('derives active token query from trailing draft token', () => {
        expect(getActiveTokenQuery('@home, @wo', '@')).toBe('wo');
        expect(getActiveTokenQuery('@home, work', '@')).toBe('work');
        expect(getActiveTokenQuery('#urgent, idea', '#')).toBe('idea');
        expect(getActiveTokenQuery('@home, ', '@')).toBe('');
    });

    it('replaces trailing token draft while preserving prior entries', () => {
        expect(replaceTrailingToken('@home, @wo', '@work')).toBe('@home, @work, ');
        expect(replaceTrailingToken(undefined, '@home')).toBe('@home, ');
    });
});
