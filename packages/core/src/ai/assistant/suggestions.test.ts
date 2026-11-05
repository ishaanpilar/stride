import { describe, expect, it } from 'vitest';
import { MAX_SUGGESTION_LENGTH, parseAssistantReply } from './suggestions';

const block = (body: string) => `Summary line.\n\n\`\`\`suggestions\n${body}\n\`\`\``;

describe('parseAssistantReply', () => {
    it('extracts valid suggestions and strips the block', () => {
        const r = parseAssistantReply(block('["Merge the duplicates", "Plan my tomorrow"]'));
        expect(r.suggestions).toEqual(['Merge the duplicates', 'Plan my tomorrow']);
        expect(r.text).toBe('Summary line.');
    });

    it('returns text unchanged with no suggestions when there is no block', () => {
        expect(parseAssistantReply('Just text.')).toEqual({ text: 'Just text.', suggestions: [] });
    });

    it('strips malformed blocks and yields no chips', () => {
        for (const body of ['not json', '{"a":1}', '["unterminated', '"string"', '[1,2,{"x":1}]']) {
            const r = parseAssistantReply(block(body));
            expect(r.suggestions).toEqual([]);
            expect(r.text).toBe('Summary line.');
        }
    });

    it('caps count at 4, dedupes, and drops oversized or empty items', () => {
        const long = 'x'.repeat(MAX_SUGGESTION_LENGTH + 1);
        const r = parseAssistantReply(block(JSON.stringify(['a', 'A', long, '', '  ', 'b', 'c', 'd', 'e', 'f'])));
        expect(r.suggestions).toEqual(['a', 'b', 'c', 'd']);
    });

    it('drops injection-ish strings', () => {
        const r = parseAssistantReply(block(JSON.stringify([
            '<script>alert(1)</script>', 'javascript:alert(1)', '[x](https://evil.test)', '`rm -rf`', 'Plan my day',
        ])));
        expect(r.suggestions).toEqual(['Plan my day']);
    });

    it('handles an unterminated fence at end of text', () => {
        const r = parseAssistantReply('Hi\n```suggestions\n["One"]');
        expect(r.suggestions).toEqual(['One']);
        expect(r.text).toBe('Hi');
    });
});
