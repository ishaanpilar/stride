import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronsUpDown, FolderOpen } from 'lucide-react';

import { useLanguage } from '../../contexts/language-context';
import { cn } from '../../lib/utils';
import { useWorkspaces } from './use-workspaces';
import { ExitGhost } from '../ui/ExitGhost';
import { Collapse } from '../ui/Collapse';
import { SIDEBAR_SWITCHER_ROW_CLASS } from '../ui/SidebarAreaFilter';

function ColorDot({ color }: { color: string | null }) {
    return (
        <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center">
            <span
                className={cn('h-2.5 w-2.5 rounded-full', !color && 'bg-muted-foreground/40')}
                style={color ? { backgroundColor: color } : undefined}
            />
        </span>
    );
}


export function SidebarWorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
    const { t } = useLanguage();
    const { list, nameOf, requestSwitch, confirmModal, switching } = useWorkspaces();
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        const handleClick = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    if (!list || list.workspaces.length < 2) return null;
    const active = list.workspaces.find((workspace) => workspace.id === list.activeId) ?? list.workspaces[0];
    const activeName = nameOf(active);
    const label = `${t('workspaces.switcherLabel')}: ${activeName}`;

    const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1);
        items[next]?.focus();
    };

    const menu = (
        <div
            role="menu"
            aria-label={t('workspaces.switcherLabel')}
            className="space-y-0.5"
            onKeyDown={moveFocus}
        >
            {list.workspaces.map((workspace) => {
                const isActive = workspace.id === list.activeId;
                return (
                    <button
                        key={workspace.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        onClick={() => {
                            setOpen(false);
                            void requestSwitch(workspace);
                        }}
                        title={nameOf(workspace)}
                        className={cn(SIDEBAR_SWITCHER_ROW_CLASS, isActive && 'bg-accent-soft font-semibold hover:bg-accent-soft')}
                    >
                        <ColorDot color={workspace.color} />
                        <span className="min-w-0 flex-1 truncate">{nameOf(workspace)}</span>
                        <Check className={cn('h-4 w-4 shrink-0 text-accent-text', isActive ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                    </button>
                );
            })}
        </div>
    );

    return (
        <div ref={containerRef} className={cn('relative mb-1', !collapsed && 'min-w-0')} data-workspace-switcher>
            {!collapsed && (
                <Collapse open={open} className={cn(open && 'mb-1')} innerClassName="border-b border-border/60 pb-1">
                    {menu}
                </Collapse>
            )}
            {collapsed && open && (
                <div className="motion-popover absolute bottom-0 left-full z-30 ml-2 w-64 rounded-sheet bg-card p-1.5 shadow-soft [--motion-origin:bottom_left]">
                    <ExitGhost />
                    {menu}
                </div>
            )}
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                onKeyDown={(event) => {
                    if (event.key === 'Escape' && open) {
                        event.preventDefault();
                        setOpen(false);
                    }
                }}
                disabled={switching}
                className={cn(
                    collapsed
                        ? 'focus-ring flex h-10 w-10 items-center justify-center rounded-control text-foreground transition-colors hover:bg-accent'
                        : SIDEBAR_SWITCHER_ROW_CLASS,
                    open && !collapsed && 'bg-accent',
                )}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={label}
                title={label}
            >
                {collapsed ? (
                    <span className="relative">
                        <FolderOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="absolute -right-1.5 -top-1.5">
                            <ColorDot color={active.color} />
                        </span>
                    </span>
                ) : (
                    <>
                        <ColorDot color={active.color} />
                        <span className="min-w-0 flex-1 truncate">{activeName}</span>
                        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </>
                )}
            </button>
            {confirmModal}
        </div>
    );
}
