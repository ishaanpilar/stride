import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Area } from '@stride/core';

import { AREA_FILTER_NONE } from '@stride/core';
import { SidebarAreaFilter } from './SidebarAreaFilter';

const areas: Area[] = [
    { id: 'a1', name: 'Work', color: '#3b82f6', order: 0, createdAt: '', updatedAt: '' },
    { id: 'a2', name: 'Home', color: '#10b981', order: 1, createdAt: '', updatedAt: '' },
];

const renderFilter = (
    selection: { included: string[]; excluded: string[] },
    onChange = vi.fn(),
    collapsed = false,
    extra: Partial<Parameters<typeof SidebarAreaFilter>[0]> = {},
) => ({
    onChange,
    ...render(
        <div>
            <button type="button">outside</button>
            <SidebarAreaFilter
                areas={areas}
                selection={selection}
                onChange={onChange}
                ariaLabel="Area filter"
                allAreasLabel="All areas"
                noAreaLabel="No area"
                excludedLabel="Excluded"
                collapsed={collapsed}
                {...extra}
            />
        </div>,
    ),
});

describe('SidebarAreaFilter', () => {
    it('expands in place into full-size rows and collapses after picking one area', () => {
        const { getByRole, queryByRole, onChange, container } = renderFilter({ included: [], excluded: [] });
        const trigger = getByRole('button', { name: 'Area filter' });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveClass('h-9', 'text-sm');
        expect(queryByRole('listbox')).toBeNull();

        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const list = getByRole('listbox', { name: 'Area filter' });
        // Inline in the sidebar, not a floating popover.
        expect(container.querySelector('[data-area-switcher] .motion-collapse')).toContainElement(list);
        expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual(['All areas', 'Work', 'Home', 'No area']);
        expect(within(list).getByRole('option', { name: 'All areas' })).toHaveAttribute('aria-selected', 'true');
        for (const option of within(list).getAllByRole('option')) expect(option).toHaveClass('h-9', 'text-sm');

        fireEvent.click(within(list).getByRole('option', { name: 'Work' }));
        expect(onChange).toHaveBeenCalledWith({ included: ['a1'], excluded: [] });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveFocus();
    });

    it('picks one area only, replacing an earlier multi-selection', () => {
        const { getByRole, onChange } = renderFilter({ included: ['a1'], excluded: ['a2'] });
        fireEvent.click(getByRole('button', { name: 'Area filter' }));
        fireEvent.click(getByRole('option', { name: 'No area' }));
        expect(onChange).toHaveBeenCalledWith({ included: [AREA_FILTER_NONE], excluded: [] });
    });

    it('cycles include, exclude, off with Cmd-click and stays open', () => {
        const onChange = vi.fn();
        const first = renderFilter({ included: [], excluded: [] }, onChange);
        fireEvent.click(first.getByRole('button', { name: 'Area filter' }));
        fireEvent.click(first.getByRole('option', { name: 'Work' }), { metaKey: true });
        expect(onChange).toHaveBeenLastCalledWith({ included: ['a1'], excluded: [] });
        expect(first.getByRole('listbox')).toBeInTheDocument();
        first.unmount();

        const included = renderFilter({ included: ['a1'], excluded: [] }, onChange);
        fireEvent.click(included.getByRole('button', { name: 'Area filter' }));
        fireEvent.click(included.getByRole('option', { name: 'Work' }), { ctrlKey: true });
        expect(onChange).toHaveBeenLastCalledWith({ included: [], excluded: ['a1'] });
        included.unmount();

        const excluded = renderFilter({ included: [], excluded: ['a1'] }, onChange);
        fireEvent.click(excluded.getByRole('button', { name: 'Area filter' }));
        expect(excluded.getByRole('option', { name: 'Work (Excluded)' })).toBeInTheDocument();
        fireEvent.click(excluded.getByRole('option', { name: 'Work (Excluded)' }), { metaKey: true });
        expect(onChange).toHaveBeenLastCalledWith({ included: [], excluded: [] });
    });

    it('clears the selection from the all-areas row', () => {
        const { getByRole, onChange } = renderFilter({ included: ['a1'], excluded: [] });
        fireEvent.click(getByRole('button', { name: 'Area filter' }));
        fireEvent.click(getByRole('option', { name: 'All areas' }));
        expect(onChange).toHaveBeenCalledWith({ included: [], excluded: [] });
    });

    it('labels the trigger with the single selected area and a count beyond that', () => {
        const { getByRole, unmount } = renderFilter({ included: ['a1'], excluded: [] });
        within(getByRole('button', { name: 'Area filter' })).getByText('Work');
        unmount();

        const multi = renderFilter({ included: ['a1'], excluded: ['a2'] });
        within(multi.getByRole('button', { name: 'Area filter' })).getByText('Work · Excluded: Home');
        within(multi.getByRole('button', { name: 'Area filter' })).getByText('2');
    });

    it('is keyboard accessible: arrows move, Space toggles, Enter picks, Esc collapses', () => {
        const { getByRole, queryByRole, onChange } = renderFilter({ included: [], excluded: [] });
        const trigger = getByRole('button', { name: 'Area filter' });
        fireEvent.keyDown(trigger, { key: 'ArrowUp' });
        const list = getByRole('listbox');
        expect(document.activeElement?.textContent).toBe('All areas');
        fireEvent.keyDown(list, { key: 'ArrowDown' });
        expect(document.activeElement?.textContent).toBe('Work');
        fireEvent.keyDown(list, { key: ' ' });
        expect(onChange).toHaveBeenLastCalledWith({ included: ['a1'], excluded: [] });
        expect(getByRole('listbox')).toBeInTheDocument();
        fireEvent.keyDown(list, { key: 'End' });
        expect(document.activeElement?.textContent).toBe('No area');
        fireEvent.keyDown(list, { key: 'Home' });
        fireEvent.keyDown(list, { key: 'ArrowDown' });
        fireEvent.keyDown(list, { key: 'ArrowDown' });
        expect(document.activeElement?.textContent).toBe('Home');
        fireEvent.keyDown(list, { key: 'Enter' });
        expect(onChange).toHaveBeenLastCalledWith({ included: ['a2'], excluded: [] });
        expect(queryByRole('listbox')).toBeNull();

        fireEvent.click(trigger);
        fireEvent.keyDown(getByRole('listbox'), { key: 'Escape' });
        expect(queryByRole('listbox')).toBeNull();
        expect(trigger).toHaveFocus();
    });

    it('collapses on an outside click', () => {
        const { getByRole, queryByRole } = renderFilter({ included: [], excluded: [] });
        fireEvent.click(getByRole('button', { name: 'Area filter' }));
        expect(getByRole('listbox')).toBeInTheDocument();
        fireEvent.mouseDown(getByRole('button', { name: 'outside' }));
        expect(queryByRole('listbox')).toBeNull();
    });

    it('shows open-task counts, truncates long names with a tooltip, and offers Manage areas', () => {
        const onManageAreas = vi.fn();
        const longName = 'Limontage Digital Marketing and every client retainer we run for them';
        const { getByRole, queryByRole } = render(
            <SidebarAreaFilter
                areas={[...areas, { id: 'a3', name: longName, color: '#f97316', order: 2, createdAt: '', updatedAt: '' }]}
                selection={{ included: [], excluded: [] }}
                onChange={vi.fn()}
                ariaLabel="Area filter"
                allAreasLabel="All areas"
                noAreaLabel="No area"
                excludedLabel="Excluded"
                counts={{ a1: 4, [AREA_FILTER_NONE]: 2 }}
                onManageAreas={onManageAreas}
                manageAreasLabel="Manage areas"
            />,
        );
        fireEvent.click(getByRole('button', { name: 'Area filter' }));
        expect(getByRole('option', { name: 'Work' })).toHaveTextContent('Work4');
        expect(getByRole('option', { name: 'No area' })).toHaveTextContent('No area2');
        expect(getByRole('option', { name: 'Home' })).toHaveTextContent(/^Home$/);
        const long = getByRole('option', { name: longName });
        expect(long).toHaveAttribute('title', longName);
        expect(long.querySelector('span.truncate')).toHaveClass('min-w-0', 'flex-1');
        expect(getByRole('listbox')).toHaveClass('overflow-x-hidden');
        fireEvent.click(getByRole('button', { name: 'Manage areas' }));
        expect(onManageAreas).toHaveBeenCalledOnce();
        expect(queryByRole('listbox')).toBeNull();
    });

    it('opens as a side popover from the collapsed sidebar', () => {
        const { getByRole, onChange } = renderFilter({ included: ['a1'], excluded: [] }, vi.fn(), true);
        fireEvent.click(getByRole('button', { name: 'Area filter: Work' }));
        fireEvent.click(within(getByRole('listbox', { name: 'Area filter' })).getByText('Home'));
        expect(onChange).toHaveBeenCalledWith({ included: ['a2'], excluded: [] });
    });
});
