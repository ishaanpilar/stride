import { Fragment, useMemo } from 'react';
import { cn } from '../../../lib/utils';
import { parseMarkdown, type InlineNode } from './assistant-markdown';

function Inline({ nodes }: { nodes: InlineNode[] }) {
    return (
        <>
            {nodes.map((n, i) => {
                switch (n.kind) {
                    case 'bold': return <strong key={i} className="font-semibold">{n.text}</strong>;
                    case 'code': return <code key={i} className="rounded bg-well px-1 py-0.5 text-[12px]">{n.text}</code>;
                    case 'task': return <span key={i} data-testid="assistant-task-chip" className="mx-0.5 inline rounded-md bg-accent-soft px-1.5 py-0.5 text-[13px] font-medium text-accent-text [overflow-wrap:anywhere]">{n.text}</span>;
                    default: return <Fragment key={i}>{n.text}</Fragment>;
                }
            })}
        </>
    );
}

/** Renders assistant markdown as React nodes (never HTML), compact and readable at ~65ch. */
export function AssistantMarkdown({ text, className }: { text: string; className?: string }) {
    const blocks = useMemo(() => parseMarkdown(text), [text]);
    return (
        <div className={cn('max-w-[65ch] space-y-1.5 text-sm leading-[1.45] [overflow-wrap:anywhere]', className)} data-testid="assistant-markdown">
            {blocks.map((b, i) => {
                if (b.kind === 'heading') {
                    return <h3 key={i} className={cn('text-xs font-semibold text-muted-foreground', i > 0 && 'pt-1.5')}>{b.text}</h3>;
                }
                if (b.kind === 'list') {
                    const Tag = b.ordered ? 'ol' : 'ul';
                    return (
                        <Tag key={i} className={cn('space-y-1 pl-4', b.ordered ? 'list-decimal' : 'list-disc', 'marker:text-tertiary')}>
                            {b.items.map((item, j) => <li key={j}><Inline nodes={item} /></li>)}
                        </Tag>
                    );
                }
                return <p key={i}><Inline nodes={b.inline} /></p>;
            })}
        </div>
    );
}
