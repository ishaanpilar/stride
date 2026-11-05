/**
 * Tiny, safe markdown subset for assistant replies: headings, bullets, numbered lists, paragraphs,
 * **bold**, `code` and 'quoted task names'. Output is plain data rendered as React text nodes,
 * so untrusted model text can never become markup.
 */
export type InlineNode =
    | { kind: 'text'; text: string }
    | { kind: 'bold'; text: string }
    | { kind: 'code'; text: string }
    | { kind: 'task'; text: string };

export type Block =
    | { kind: 'heading'; text: string }
    | { kind: 'paragraph'; inline: InlineNode[] }
    | { kind: 'list'; ordered: boolean; items: InlineNode[][] };

const MAX_LENGTH = 20_000;
const INLINE_RE = /\*\*([^*\n]+?)\*\*|`([^`\n]+?)`|(?<![\w'’])['‘]([^'‘’\n]{2,100}?)['’](?![\w'’])/g;

export function parseInline(input: string): InlineNode[] {
    const nodes: InlineNode[] = [];
    let last = 0;
    for (const m of input.matchAll(INLINE_RE)) {
        const index = m.index ?? 0;
        if (index > last) nodes.push({ kind: 'text', text: input.slice(last, index) });
        if (m[1] !== undefined) nodes.push({ kind: 'bold', text: m[1] });
        else if (m[2] !== undefined) nodes.push({ kind: 'code', text: m[2] });
        else nodes.push({ kind: 'task', text: m[3] });
        last = index + m[0].length;
    }
    if (last < input.length) nodes.push({ kind: 'text', text: input.slice(last) });
    return nodes;
}

const HEADING_RE = /^#{1,6}\s+(.+?)\s*#*$/;
const BOLD_LINE_RE = /^\*\*([^*]+?)\*\*:?$/;
const BULLET_RE = /^[-*•]\s+(.+)$/;
const NUMBER_RE = /^\d{1,3}[.)]\s+(.+)$/;

export function parseMarkdown(source: string): Block[] {
    const lines = String(source ?? '').slice(0, MAX_LENGTH).replace(/\r\n?/g, '\n').split('\n');
    const blocks: Block[] = [];
    let para: string[] = [];
    let list: { ordered: boolean; items: InlineNode[][] } | null = null;

    const flushPara = () => {
        if (para.length) blocks.push({ kind: 'paragraph', inline: parseInline(para.join(' ')) });
        para = [];
    };
    const flushList = () => {
        if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
        list = null;
    };

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) { flushPara(); flushList(); continue; }
        const heading = HEADING_RE.exec(line) ?? BOLD_LINE_RE.exec(line);
        if (heading) {
            flushPara(); flushList();
            blocks.push({ kind: 'heading', text: heading[1].replace(/[*`]/g, '').replace(/:$/, '').trim() });
            continue;
        }
        const bullet = BULLET_RE.exec(line);
        const numbered = bullet ? null : NUMBER_RE.exec(line);
        const item = bullet?.[1] ?? numbered?.[1];
        if (item !== undefined) {
            flushPara();
            const ordered = !bullet;
            if (list && list.ordered !== ordered) flushList();
            if (!list) list = { ordered, items: [] };
            list.items.push(parseInline(item));
            continue;
        }
        // Indented continuation of a list item.
        if (list && /^\s+/.test(raw)) {
            const items: InlineNode[][] = list.items;
            items[items.length - 1] = [...items[items.length - 1], { kind: 'text', text: ` ${line}` }];
            continue;
        }
        flushList();
        para.push(line);
    }
    flushPara(); flushList();
    return blocks;
}
