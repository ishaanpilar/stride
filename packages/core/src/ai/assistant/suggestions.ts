/**
 * Follow-up suggestion chips. The model may end a reply with a fenced block:
 *
 *   ```suggestions
 *   ["Merge the duplicates", "Plan my tomorrow"]
 *   ```
 *
 * The model output is untrusted: we validate defensively, cap the count and length, and always
 * strip the block from the visible text (even when its content is unusable).
 */
export const MAX_SUGGESTIONS = 4;
export const MAX_SUGGESTION_LENGTH = 60;

export interface ParsedReply {
    text: string;
    suggestions: string[];
}

const BLOCK_RE = /(?:^|\n)[ \t]*```[ \t]*suggestions[ \t]*\r?\n([\s\S]*?)(?:\r?\n[ \t]*```|$)/gi;

function cleanSuggestion(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    // Single line, no control characters, collapsed whitespace.
    const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || text.length > MAX_SUGGESTION_LENGTH) return null;
    // Chips are sent back as plain user messages; reject markup-ish or link-ish strings.
    if (/[<>`]/.test(text) || /\b(?:https?|javascript|data):/i.test(text) || /\]\(/.test(text)) return null;
    return text;
}

export function sanitizeSuggestions(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of value) {
        const clean = cleanSuggestion(item);
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(clean);
        if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
}

export function parseAssistantReply(raw: string): ParsedReply {
    if (typeof raw !== 'string' || !raw) return { text: '', suggestions: [] };
    let suggestions: string[] = [];
    const text = raw.replace(BLOCK_RE, (_match, body: string) => {
        if (suggestions.length === 0) {
            try {
                suggestions = sanitizeSuggestions(JSON.parse(String(body).trim()));
            } catch {
                suggestions = [];
            }
        }
        return '';
    }).trim();
    return { text, suggestions };
}
