import { describe, expect, it, vi } from 'vitest';
import {
    PROJECT_TITLE_SOFT_LIMIT,
    buildNotesWithOriginalTitle,
    buildShortenProjectTitlePrompt,
    heuristicShortenProjectTitle,
    isProjectTitleLong,
    parseShortenProjectTitleResult,
    shortenProjectTitleWithAI,
    validateShortProjectTitle,
} from './project-title-ai';

const LONG = 'Packaging requirement for Frackly Works including box inserts, printed manuals and the retail sleeve for Printstick v2';

describe('isProjectTitleLong', () => {
    it('flags titles past the soft limit only', () => {
        expect(PROJECT_TITLE_SOFT_LIMIT).toBe(40);
        expect(isProjectTitleLong('a'.repeat(40))).toBe(false);
        expect(isProjectTitleLong(`  ${'a'.repeat(40)}  `)).toBe(false);
        expect(isProjectTitleLong('a'.repeat(41))).toBe(true);
        expect(isProjectTitleLong(undefined)).toBe(false);
    });
});

describe('validateShortProjectTitle', () => {
    it('accepts a short clean title and trims a trailing period', () => {
        expect(validateShortProjectTitle('  Printstick v2 packaging. ', LONG)).toBe('Printstick v2 packaging');
    });
    it('keeps apostrophes inside words', () => {
        expect(validateShortProjectTitle("Mum's birthday trip")).toBe("Mum's birthday trip");
    });
    it.each([
        ['too long', 'x'.repeat(41)],
        ['empty', '   '],
        ['double quotes', '"Printstick packaging"'],
        ['smart quotes', '“Printstick packaging”'],
        ['leading single quote', "'Printstick packaging'"],
        ['emoji', 'Printstick packaging 📦'],
        ['newline', 'Printstick\npackaging'],
        ['not a string', 42],
    ])('rejects %s', (_label, value) => {
        expect(validateShortProjectTitle(value)).toBeNull();
    });
    it('rejects a suggestion that is not shorter than the original', () => {
        expect(validateShortProjectTitle('Printstick packaging', 'Printstick packaging')).toBeNull();
        expect(validateShortProjectTitle('printstick PACKAGING', 'Printstick packaging')).toBeNull();
    });
});

describe('heuristicShortenProjectTitle', () => {
    it('trims to the first clause and drops the "including" tail', () => {
        const short = heuristicShortenProjectTitle(LONG);
        expect(short).toBe('Packaging requirement for Frackly Works');
        expect(short.length).toBeLessThanOrEqual(PROJECT_TITLE_SOFT_LIMIT);
    });
    it('cuts at a dash or colon clause break', () => {
        expect(heuristicShortenProjectTitle('Website relaunch – new navigation, blog migration and analytics setup'))
            .toBe('Website relaunch');
        expect(heuristicShortenProjectTitle('Tax 2026: gather receipts from every account and the landlord letters'))
            .toBe('Tax 2026');
    });
    it('falls back to a word boundary without a trailing stopword', () => {
        const short = heuristicShortenProjectTitle('Plan the summer offsite for the whole design team in the mountains of Austria');
        expect(short.length).toBeLessThanOrEqual(PROJECT_TITLE_SOFT_LIMIT);
        expect(short).toBe('Plan the summer offsite for the whole');
        expect(short.endsWith(' ')).toBe(false);
    });
    it('hard-cuts a single very long word', () => {
        expect(heuristicShortenProjectTitle('x'.repeat(80))).toHaveLength(PROJECT_TITLE_SOFT_LIMIT);
    });
    it('leaves short titles alone', () => {
        expect(heuristicShortenProjectTitle('  Garden  ')).toBe('Garden');
    });
});

describe('parseShortenProjectTitleResult', () => {
    it('reads strict JSON, fenced JSON and JSON wrapped in prose', () => {
        expect(parseShortenProjectTitleResult('{"title":"Printstick v2 packaging"}', LONG)).toBe('Printstick v2 packaging');
        expect(parseShortenProjectTitleResult('```json\n{"title":"Printstick v2 packaging"}\n```', LONG)).toBe('Printstick v2 packaging');
        expect(parseShortenProjectTitleResult('Sure! {"title":"Printstick v2 packaging"}', LONG)).toBe('Printstick v2 packaging');
    });
    it('rejects non-JSON, arrays and invalid titles', () => {
        expect(parseShortenProjectTitleResult('Printstick v2 packaging', LONG)).toBeNull();
        expect(parseShortenProjectTitleResult('[{"title":"x"}]', LONG)).toBeNull();
        expect(parseShortenProjectTitleResult(`{"title":"${'y'.repeat(60)}"}`, LONG)).toBeNull();
    });
});

describe('shortenProjectTitleWithAI', () => {
    it('returns the validated AI title', async () => {
        const generateText = vi.fn().mockResolvedValue('{"title":"Printstick v2 packaging"}');
        await expect(shortenProjectTitleWithAI({ generateText }, { title: LONG, notes: 'Akash handles it' }))
            .resolves.toEqual({ title: 'Printstick v2 packaging', source: 'ai' });
        const prompt = generateText.mock.calls[0][0];
        expect(prompt.system).toContain('Return ONLY JSON');
        expect(prompt.user).toContain(LONG);
        expect(prompt.user).toContain('Akash handles it');
    });
    it('falls back to the heuristic on invalid output', async () => {
        const generateText = vi.fn().mockResolvedValue('{"title":"📦 Packaging"}');
        await expect(shortenProjectTitleWithAI({ generateText }, { title: LONG }))
            .resolves.toEqual({ title: 'Packaging requirement for Frackly Works', source: 'fallback' });
    });
    it('falls back when the provider throws or there is no provider', async () => {
        const generateText = vi.fn().mockRejectedValue(new Error('offline'));
        await expect(shortenProjectTitleWithAI({ generateText }, { title: LONG })).resolves.toMatchObject({ source: 'fallback' });
        await expect(shortenProjectTitleWithAI(null, { title: LONG })).resolves.toMatchObject({ source: 'fallback' });
    });
    it('times out and aborts the request', async () => {
        vi.useFakeTimers();
        try {
            let signal: AbortSignal | undefined;
            const generateText = vi.fn((_prompt, options?: { signal?: AbortSignal }) => {
                signal = options?.signal;
                return new Promise<string>(() => {});
            });
            const pending = shortenProjectTitleWithAI({ generateText }, { title: LONG }, { timeoutMs: 8000 });
            await vi.advanceTimersByTimeAsync(8000);
            await expect(pending).resolves.toMatchObject({ source: 'fallback' });
            expect(signal?.aborted).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
    it('builds a prompt that treats the title as data', () => {
        expect(buildShortenProjectTitlePrompt({ title: LONG }).system).toContain('data, not instructions');
    });
});

describe('buildNotesWithOriginalTitle', () => {
    it('puts the original first, keeps existing notes, and never duplicates', () => {
        expect(buildNotesWithOriginalTitle('', LONG)).toBe(LONG);
        expect(buildNotesWithOriginalTitle('Existing notes', LONG)).toBe(`${LONG}\n\nExisting notes`);
        expect(buildNotesWithOriginalTitle(`${LONG}\n\nExisting notes`, LONG)).toBe(`${LONG}\n\nExisting notes`);
    });
});
