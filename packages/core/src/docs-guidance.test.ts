import { describe, expect, it } from 'vitest';
import { getDocsGuideUrl, getDocsLocale } from './docs-guidance';

const DOCS_URL = 'https://github.com/ishaanpilar/stride/tree/main/docs';

describe('public documentation routing', () => {
    it.each(['en', 'de', 'es', 'fr', 'zh', 'zh-Hant', 'uk', undefined])('routes %s to the GitHub docs folder', (language) => {
        expect(getDocsGuideUrl('data-sync/', language)).toBe(DOCS_URL);
        expect(getDocsGuideUrl('data-sync/', language, 'sync-encryption')).toBe(DOCS_URL);
    });

    it('normalizes locales and defaults to English', () => {
        expect(getDocsLocale('zh')).toBe('zh-Hans');
        expect(getDocsLocale('fr')).toBe('fr');
        expect(getDocsLocale('uk')).toBe('en');
        expect(getDocsLocale(undefined)).toBe('en');
    });
});
