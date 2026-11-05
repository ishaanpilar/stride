import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { Area, AreaFilterSelection } from '@stride/core';
import { Check, ChevronsUpDown, Layers, Settings2, X } from 'lucide-react';

import {
    AREA_FILTER_NONE,
    cycleAreaFilterSelection,
    isAreaFilterSelectionActive,
} from '@stride/core';
import { cn } from '../../lib/utils';
import { Collapse } from './Collapse';

interface SidebarAreaFilterProps {
    areas: Area[];
    selection: AreaFilterSelection;
    onChange: (selection: AreaFilterSelection) => void;
    ariaLabel: string;
    allAreasLabel: string;
    noAreaLabel: string;
    excludedLabel: string;
    collapsed?: boolean;
    /** Open-task counts by area id (AREA_FILTER_NONE for tasks without an area). */
    counts?: Record<string, number>;
    onManageAreas?: () => void;
    manageAreasLabel?: string;
    /** Told when the inline list expands/collapses (the sidebar keeps its layout steady meanwhile). */
    onOpenChange?: (open: boolean) => void;
}

/** Shared 36px row style for the sidebar's inline switchers (areas, workspaces). */
export const SIDEBAR_SWITCHER_ROW_CLASS = 'focus-ring-inset flex h-9 w-full min-w-0 items-center gap-2.5 rounded-control px-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent';

const ALL_AREAS_ID = '__all_areas__';

type Option = { id: string; label: string; color?: string };

function AreaDot({ color, muted = false }: { color?: string; muted?: boolean }) {
    return (
        <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center">
            <span
                className={cn('h-2.5 w-2.5 rounded-full', !color && (muted ? 'border border-muted-foreground/60' : 'bg-muted-foreground/40'))}
                style={color ? { backgroundColor: color } : undefined}
            />
        </span>
    );
}

/**
 * The area filter at the bottom of the sidebar: a row showing the current area that expands in
 * place (upwards) into a full-size list, like an account switcher. Click or Enter picks one area
 * and folds the list; Cmd/Ctrl-click or Space toggles several (include, exclude, off) and keeps it
 * open. Esc or a click outside folds it.
 */
export function SidebarAreaFilter({
    areas,
    selection,
    onChange,
    ariaLabel,
    allAreasLabel,
    noAreaLabel,
    excludedLabel,
    collapsed = false,
    counts,
    onManageAreas,
    manageAreasLabel = 'Manage areas…',
    onOpenChange,
}: SidebarAreaFilterProps) {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listId = useId();

    const areaOptions = useMemo<Option[]>(() => ([
        ...areas.map((area) => ({ id: area.id, label: area.name, color: area.color })),
        { id: AREA_FILTER_NONE, label: noAreaLabel },
    ]), [areas, noAreaLabel]);
    const options = useMemo<Option[]>(() => [{ id: ALL_AREAS_ID, label: allAreasLabel }, ...areaOptions], [allAreasLabel, areaOptions]);

    const isActive = isAreaFilterSelectionActive(selection);
    const activeCount = selection.included.length + selection.excluded.length;
    const labelFor = (id: string) => areaOptions.find((option) => option.id === id)?.label ?? noAreaLabel;
    const selectedLabel = !isActive
        ? allAreasLabel
        : [
            selection.included.map(labelFor).join(', '),
            selection.excluded.length > 0 ? `${excludedLabel}: ${selection.excluded.map(labelFor).join(', ')}` : '',
        ].filter(Boolean).join(' · ');
    const triggerLabel = collapsed ? `${ariaLabel}: ${selectedLabel}` : ariaLabel;
    const singleSelected = selection.excluded.length === 0 && selection.included.length === 1
        ? areaOptions.find((option) => option.id === selection.included[0])
        : undefined;

    const isSelected = (id: string) => (id === ALL_AREAS_ID ? !isActive : selection.included.includes(id));
    const isExcluded = (id: string) => id !== ALL_AREAS_ID && selection.excluded.includes(id);

    const close = (returnFocus = false) => {
        setOpen(false);
        if (returnFocus) triggerRef.current?.focus();
    };

    const openList = () => {
        const firstSelected = options.findIndex((option) => isSelected(option.id) || isExcluded(option.id));
        setActiveIndex(firstSelected >= 0 ? firstSelected : 0);
        setOpen(true);
    };

    const onOpenChangeRef = useRef(onOpenChange);
    onOpenChangeRef.current = onOpenChange;
    useEffect(() => {
        onOpenChangeRef.current?.(open);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handleClick = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        listRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.focus();
    }, [open, activeIndex]);

    const pickOnly = (id: string) => {
        onChange(id === ALL_AREAS_ID ? { included: [], excluded: [] } : { included: [id], excluded: [] });
        close(true);
    };
    const toggle = (id: string) => {
        onChange(id === ALL_AREAS_ID ? { included: [], excluded: [] } : cycleAreaFilterSelection(selection, id));
    };

    const onOptionClick = (event: ReactMouseEvent, id: string, index: number) => {
        setActiveIndex(index);
        if (event.metaKey || event.ctrlKey) toggle(id);
        else pickOnly(id);
    };

    const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const last = options.length - 1;
        switch (event.key) {
            case 'ArrowDown': event.preventDefault(); setActiveIndex((index) => Math.min(last, index + 1)); return;
            case 'ArrowUp': event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); return;
            case 'Home': event.preventDefault(); setActiveIndex(0); return;
            case 'End': event.preventDefault(); setActiveIndex(last); return;
            case 'Enter': event.preventDefault(); pickOnly(options[activeIndex].id); return;
            case ' ': event.preventDefault(); toggle(options[activeIndex].id); return;
            case 'Escape': event.preventDefault(); close(true); return;
            default:
        }
    };

    const list: ReactNode = (
        <>
            <div
                ref={listRef}
                id={listId}
                role="listbox"
                aria-label={ariaLabel}
                aria-multiselectable="true"
                onKeyDown={onListKeyDown}
                className="max-h-[min(45vh,22rem)] space-y-0.5 overflow-y-auto overflow-x-hidden"
                data-area-filter-list
            >
                {options.map((option, index) => {
                    const selected = isSelected(option.id);
                    const excluded = isExcluded(option.id);
                    const count = option.id === ALL_AREAS_ID ? undefined : counts?.[option.id];
                    return (
                        <div
                            key={option.id}
                            role="option"
                            tabIndex={index === activeIndex ? 0 : -1}
                            aria-selected={selected}
                            aria-label={excluded ? `${option.label} (${excludedLabel})` : option.label}
                            data-option-index={index}
                            data-area-filter-option="true"
                            title={option.label}
                            onClick={(event) => onOptionClick(event, option.id, index)}
                            className={cn(
                                SIDEBAR_SWITCHER_ROW_CLASS,
                                'cursor-pointer',
                                selected && 'bg-accent-soft font-semibold hover:bg-accent-soft',
                                excluded && 'text-destructive',
                            )}
                        >
                            {option.id === ALL_AREAS_ID
                                ? <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                : <AreaDot color={option.color} muted={option.id === AREA_FILTER_NONE} />}
                            <span className={cn('min-w-0 flex-1 truncate', excluded && 'line-through')}>{option.label}</span>
                            {count !== undefined && count > 0 && (
                                <span className="shrink-0 text-[13px] font-normal tabular-nums text-muted-foreground">{count}</span>
                            )}
                            {excluded
                                ? <X className="h-4 w-4 shrink-0" aria-hidden="true" />
                                : <Check className={cn('h-4 w-4 shrink-0 text-accent-text', selected ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />}
                        </div>
                    );
                })}
            </div>
            {onManageAreas && (
                <button
                    type="button"
                    onClick={() => { close(); onManageAreas(); }}
                    className={cn(SIDEBAR_SWITCHER_ROW_CLASS, 'mt-0.5 text-muted-foreground hover:text-foreground')}
                    data-area-filter-manage
                >
                    <Settings2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{manageAreasLabel}</span>
                </button>
            )}
        </>
    );

    return (
        <div ref={containerRef} className={cn('relative', !collapsed && 'min-w-0')} data-area-switcher data-state={open ? 'open' : 'closed'}>
            {!collapsed && (
                <Collapse open={open} className={cn(open && 'mb-1')} innerClassName="space-y-0.5 border-b border-border/60 pb-1">
                    {list}
                </Collapse>
            )}
            {collapsed && open && (
                <div className="motion-popover absolute bottom-0 left-full z-30 ml-2 w-64 rounded-sheet bg-card p-1.5 shadow-soft [--motion-origin:bottom_left]">
                    {list}
                </div>
            )}
            <button
                ref={triggerRef}
                type="button"
                onClick={() => (open ? close() : openList())}
                onKeyDown={(event) => {
                    if (event.key === 'Escape' && open) {
                        event.preventDefault();
                        close();
                    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !open) {
                        event.preventDefault();
                        openList();
                    }
                }}
                className={cn(
                    collapsed
                        ? 'focus-ring flex h-10 w-10 items-center justify-center rounded-control text-foreground transition-colors hover:bg-accent'
                        : SIDEBAR_SWITCHER_ROW_CLASS,
                    open && !collapsed && 'bg-accent',
                )}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-label={triggerLabel}
                title={collapsed ? triggerLabel : selectedLabel}
                data-area-filter-trigger
            >
                {collapsed ? (
                    <span className="relative">
                        <Layers className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {isActive && (
                            <span className="absolute -right-1.5 -top-1.5 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                        )}
                    </span>
                ) : (
                    <>
                        {singleSelected
                            ? <AreaDot color={singleSelected.color} muted={singleSelected.id === AREA_FILTER_NONE} />
                            : <Layers className={cn('h-4 w-4 shrink-0', isActive ? 'text-accent-text' : 'text-muted-foreground')} aria-hidden="true" />}
                        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
                        {activeCount > 1 && (
                            <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[12px] font-medium leading-5 tabular-nums text-accent-text">
                                {activeCount}
                            </span>
                        )}
                        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </>
                )}
            </button>
        </div>
    );
}
