import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaContextEditor } from './area-context-editor';

const mocks = vi.hoisted(() => ({
    updateArea: vi.fn(async () => undefined),
    addPerson: vi.fn(async (name: string) => ({ id: 'p-new', name })),
    state: {} as Record<string, unknown>,
}));

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({ bg: '#000', cardBg: '#111', border: '#222', text: '#fff', secondaryText: '#999', tint: '#39f' }),
}));
vi.mock('@stride/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@stride/core')>()),
    useTaskStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mocks.state),
}));

const render = async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<AreaContextEditor areaId="a1" t={(k) => k} />); });
    return tree;
};
const byId = (tree: renderer.ReactTestRenderer, testID: string) => tree.root.findByProps({ testID });

describe('AreaContextEditor', () => {
    beforeEach(() => {
        mocks.updateArea.mockClear();
        mocks.addPerson.mockClear();
        mocks.state = {
            areas: [{ id: 'a1', name: 'Work', keywords: ['alpha'], peopleIds: ['p1'] }],
            people: [{ id: 'p1', name: 'Asha' }, { id: 'p2', name: 'Ben' }],
            updateArea: mocks.updateArea,
            addPerson: mocks.addPerson,
        };
    });

    it('normalizes and saves the description on blur', async () => {
        const tree = await render();
        await act(async () => { byId(tree, 'area-context-description').props.onChangeText('  Client work  '); });
        await act(async () => { byId(tree, 'area-context-description').props.onBlur(); });
        expect(mocks.updateArea).toHaveBeenCalledWith('a1', { description: 'Client work' });
    });

    it('adds deduped keywords and removes them', async () => {
        const tree = await render();
        await act(async () => { byId(tree, 'area-context-keyword-input').props.onChangeText('#Beta, ALPHA'); });
        await act(async () => { byId(tree, 'area-context-keyword-input').props.onSubmitEditing(); });
        expect(mocks.updateArea).toHaveBeenCalledWith('a1', { keywords: ['alpha', 'Beta'] });
        await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Remove keyword alpha' }).props.onPress(); });
        expect(mocks.updateArea).toHaveBeenLastCalledWith('a1', { keywords: undefined });
    });

    it('links an existing person, creates a new one, and unlinks', async () => {
        const tree = await render();
        await act(async () => { byId(tree, 'area-context-person-input').props.onChangeText('ben'); });
        await act(async () => { await byId(tree, 'area-context-person-input').props.onSubmitEditing(); });
        expect(mocks.addPerson).not.toHaveBeenCalled();
        expect(mocks.updateArea).toHaveBeenCalledWith('a1', { peopleIds: ['p1', 'p2'] });
        await act(async () => { byId(tree, 'area-context-person-input').props.onChangeText('Zed'); });
        await act(async () => { await byId(tree, 'area-context-person-input').props.onSubmitEditing(); });
        expect(mocks.addPerson).toHaveBeenCalledWith('Zed');
        await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Remove Asha' }).props.onPress(); });
        expect(mocks.updateArea).toHaveBeenLastCalledWith('a1', { peopleIds: undefined });
    });
});
