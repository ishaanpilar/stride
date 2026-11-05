import React from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { ExitGhost } from '../../ui/ExitGhost';

export type BoardMenuItem =
    | { type: 'heading'; id: string; label: string }
    | { type: 'separator'; id: string }
    | {
        type?: 'item';
        id: string;
        label: string;
        onSelect: () => void;
        disabled?: boolean;
        checked?: boolean;
        danger?: boolean;
        icon?: React.ReactNode;
        shortcut?: string;
    };

export type BoardMenuAnchor = { x: number; y: number; width?: number; height?: number };

type BoardMenuProps = {
    label: string;
    anchor: BoardMenuAnchor;
    items: BoardMenuItem[];
    onClose: () => void;
};

const ITEM = 'flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-start text-[13px] text-foreground focus:outline-none focus-visible:bg-accent hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';

/** Small keyboard-accessible popup menu. Used for the column "..." menu and the card context menu. */
export function BoardMenu({ label, anchor, items, onClose }: BoardMenuProps) {
    const panelRef = React.useRef<HTMLDivElement | null>(null);
    const [position, setPosition] = React.useState<{ top: number; left: number }>({ top: anchor.y + (anchor.height ?? 0), left: anchor.x });

    React.useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const rect = panel.getBoundingClientRect();
        const margin = 8;
        let left = anchor.x;
        let top = anchor.y + (anchor.height ?? 0) + 4;
        if (rect.width > 0 && left + rect.width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - rect.width - margin);
        if (rect.height > 0 && top + rect.height > window.innerHeight - margin) {
            top = Math.max(margin, anchor.y - rect.height - (anchor.height ? 4 : 0));
            if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - rect.height - margin);
        }
        setPosition({ top, left });
    }, [anchor]);

    const getEnabledItems = () => Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);

    React.useEffect(() => {
        getEnabledItems()[0]?.focus();
        const handlePointer = (event: MouseEvent) => {
            if (panelRef.current?.contains(event.target as Node)) return;
            onClose();
        };
        const handleBlurWindow = () => onClose();
        window.addEventListener('mousedown', handlePointer);
        window.addEventListener('blur', handleBlurWindow);
        return () => {
            window.removeEventListener('mousedown', handlePointer);
            window.removeEventListener('blur', handleBlurWindow);
        };
    }, []);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const enabled = getEnabledItems();
        const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
        } else if (event.key === 'Tab') {
            event.preventDefault();
            onClose();
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            enabled[(index + 1) % enabled.length]?.focus();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            enabled[(index - 1 + enabled.length) % enabled.length]?.focus();
        } else if (event.key === 'Home') {
            event.preventDefault();
            enabled[0]?.focus();
        } else if (event.key === 'End') {
            event.preventDefault();
            enabled[enabled.length - 1]?.focus();
        }
    };

    return createPortal(
        <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            data-board-menu
            onKeyDown={handleKeyDown}
            onContextMenu={(event) => event.preventDefault()}
            style={{ position: 'fixed', top: position.top, left: position.left }}
            className="motion-popover z-[80] min-w-[200px] max-w-[280px] rounded-card border border-border bg-popover p-1 text-popover-foreground shadow-soft"
        >
            <ExitGhost />
            {items.map((item) => {
                if (item.type === 'separator') return <div key={item.id} role="separator" className="my-1 h-px bg-border" />;
                if (item.type === 'heading') {
                    return (
                        <div key={item.id} role="presentation" className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {item.label}
                        </div>
                    );
                }
                const radio = typeof item.checked === 'boolean';
                return (
                    <button
                        key={item.id}
                        type="button"
                        role={radio ? 'menuitemradio' : 'menuitem'}
                        aria-checked={radio ? item.checked : undefined}
                        disabled={item.disabled}
                        data-board-menu-item={item.id}
                        onClick={() => { onClose(); item.onSelect(); }}
                        className={cn(ITEM, item.danger && 'text-destructive')}
                    >
                        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                            {radio ? (item.checked ? <Check className="h-3.5 w-3.5" /> : null) : item.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.shortcut ? <span className="shrink-0 text-xs text-muted-foreground">{item.shortcut}</span> : null}
                    </button>
                );
            })}
        </div>,
        document.body,
    );
}
