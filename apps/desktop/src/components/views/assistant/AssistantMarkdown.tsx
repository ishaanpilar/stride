import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { parseMarkdown, type InlineNode } from './assistant-markdown';

type QuotedNameStyle = 'chip' | 'text';

function Inline({ nodes, quotedNames = 'chip' }: { nodes: InlineNode[]; quotedNames?: QuotedNameStyle }) {
    return (
        <>
            {nodes.map((n, i) => {
                switch (n.kind) {
                    case 'bold': return <strong key={i} className="font-semibold">{n.text}</strong>;
                    case 'code': return <code key={i} className="rounded bg-well px-1 py-0.5 font-mono text-[12px]">{n.text}</code>;
                    case 'task':
                        if (quotedNames === 'text') return <Fragment key={i}>{`'${n.text}'`}</Fragment>;
                        return <span key={i} data-testid="assistant-task-chip" className="mx-0.5 inline rounded-md bg-accent-soft px-1.5 py-0.5 text-[13px] font-medium text-accent-text [overflow-wrap:anywhere]">{n.text}</span>;
                    default: return <Fragment key={i}>{n.text}</Fragment>;
                }
            })}
        </>
    );
}

/** Monospace block with horizontal scroll and a copy button. Text is rendered as a text node. */
export function CodeBlock({ text, lang }: { text: string; lang?: string }) {
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    const copy = async () => {
        try {
            await navigator.clipboard?.writeText(text);
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };
    return (
        <div className="overflow-hidden rounded-control bg-well shadow-soft-inset" data-testid="assistant-code-block">
            <div className="flex items-center justify-between gap-2 px-2.5 pt-1.5 text-[11px] text-muted-foreground">
                <span className="font-mono">{lang ?? 'code'}</span>
                <button
                    type="button"
                    onClick={() => void copy()}
                    aria-label={copied ? 'Copied' : 'Copy code'}
                    className="focus-ring inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 hover:bg-accent-soft hover:text-accent-text"
                >
                    {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>
            <pre className="overflow-x-auto px-2.5 pb-2 pt-1 text-[12px] leading-[1.5] [overflow-wrap:normal]"><code className="whitespace-pre font-mono">{text}</code></pre>
        </div>
    );
}

/** Renders assistant markdown as React nodes (never HTML), compact and readable at ~65ch. */
export function AssistantMarkdown({
    text,
    className,
    quotedNames = 'chip',
}: {
    text: string;
    className?: string;
    quotedNames?: QuotedNameStyle;
}) {
    const blocks = useMemo(() => parseMarkdown(text), [text]);
    return (
        <div className={cn('max-w-[65ch] space-y-1.5 text-sm leading-[1.45] [overflow-wrap:anywhere]', className)} data-testid="assistant-markdown">
            {blocks.map((b, i) => {
                if (b.kind === 'heading') {
                    return <h3 key={i} className={cn('text-xs font-semibold text-muted-foreground', i > 0 && 'pt-1.5')}>{b.text}</h3>;
                }
                if (b.kind === 'code') return <CodeBlock key={i} text={b.text} lang={b.lang} />;
                if (b.kind === 'list') {
                    const Tag = b.ordered ? 'ol' : 'ul';
                    return (
                        <Tag key={i} className={cn('space-y-1 pl-4', b.ordered ? 'list-decimal' : 'list-disc', 'marker:text-tertiary')}>
                            {b.items.map((item, j) => <li key={j}><Inline nodes={item} quotedNames={quotedNames} /></li>)}
                        </Tag>
                    );
                }
                return <p key={i}><Inline nodes={b.inline} quotedNames={quotedNames} /></p>;
            })}
        </div>
    );
}
