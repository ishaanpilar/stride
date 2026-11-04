import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AREA_FILTER_NONE, type Area, type AreaFilterSelection } from '@stride/core';

const homeArea = { id: 'area-home', name: 'Home', order: 0 } as Area;
const workArea = { id: 'area-work', name: 'Work', order: 1 } as Area;

const setAreaFilter = vi.fn();
const areaFilterState: { selection: AreaFilterSelection } = { selection: { included: [], excluded: [] } };

vi.mock('lucide-react-native', () => ({
  Check: () => null,
  ChevronDown: () => null,
  X: () => null,
}));

vi.mock('react-native', () => ({
  Modal: ({ children, ...props }: any) => React.createElement('Modal', props, children),
  Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
  ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
  StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
  Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  TouchableOpacity: ({ children, ...props }: any) => React.createElement('TouchableOpacity', props, children),
  View: ({ children, ...props }: any) => React.createElement('View', props, children),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

vi.mock('../contexts/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../contexts/toast-context', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({ border: '#334155', cardBg: '#111827', danger: '#ef4444', secondaryText: '#94a3b8', text: '#f8fafc', tint: '#38bdf8' }),
}));

vi.mock('@/components/compact-text', () => ({
  CompactText: ({ children, ...props }: any) => React.createElement('CompactText', props, children),
}));

vi.mock('@/hooks/use-mobile-area-filter', () => ({
  useMobileAreaFilter: () => ({
    areaById: new Map([[homeArea.id, homeArea], [workArea.id, workArea]]),
    didResetDeletedAreaFilter: false,
    resolvedAreaFilter: areaFilterState.selection,
    selectedAreaIdForNewTasks: undefined,
    setAreaFilter,
    sortedAreas: [homeArea, workArea],
  }),
}));

import { MobileAreaSwitcher } from './mobile-area-switcher';

const renderSwitcher = () => {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<MobileAreaSwitcher />);
  });
  return tree;
};

const pressRow = (tree: ReturnType<typeof create>, label: string) => {
  const row = tree.root.findAll((node) => (
    String(node.type) === 'TouchableOpacity' && String(node.props.accessibilityLabel ?? '').startsWith(label)
  ))[0];
  act(() => row.props.onPress());
};

describe('MobileAreaSwitcher', () => {
  beforeEach(() => {
    setAreaFilter.mockClear();
    areaFilterState.selection = { included: [], excluded: [] };
  });

  it('includes an area on the first press and excludes it on the second', () => {
    pressRow(renderSwitcher(), 'Home');
    expect(setAreaFilter).toHaveBeenCalledWith({ included: [homeArea.id], excluded: [] });

    areaFilterState.selection = { included: [homeArea.id], excluded: [] };
    pressRow(renderSwitcher(), 'Home');
    expect(setAreaFilter).toHaveBeenLastCalledWith({ included: [], excluded: [homeArea.id] });

    areaFilterState.selection = { included: [], excluded: [homeArea.id] };
    pressRow(renderSwitcher(), 'Home');
    expect(setAreaFilter).toHaveBeenLastCalledWith({ included: [], excluded: [] });
  });

  it('keeps several areas selected and labels excluded rows', () => {
    areaFilterState.selection = { included: [homeArea.id], excluded: [] };
    pressRow(renderSwitcher(), 'Work');
    expect(setAreaFilter).toHaveBeenCalledWith({ included: [homeArea.id, workArea.id], excluded: [] });

    areaFilterState.selection = { included: [homeArea.id], excluded: [workArea.id] };
    const tree = renderSwitcher();
    expect(tree.root.findAll((node) => (
      String(node.type) === 'TouchableOpacity' && node.props.accessibilityLabel === 'Work (Excluded)'
    ))).toHaveLength(1);
  });

  it('selects tasks without an area and clears from the all-areas row', () => {
    const tree = renderSwitcher();
    pressRow(tree, 'projects.noArea');
    expect(setAreaFilter).toHaveBeenCalledWith({ included: [AREA_FILTER_NONE], excluded: [] });

    areaFilterState.selection = { included: [homeArea.id], excluded: [workArea.id] };
    const active = renderSwitcher();
    act(() => {
      active.root.findAll((node) => String(node.type) === 'TouchableOpacity')[0].props.onPress();
    });
    expect(setAreaFilter).toHaveBeenLastCalledWith({ included: [], excluded: [] });
  });

  it('shows the single area name on the trigger and a count beyond that', () => {
    areaFilterState.selection = { included: [homeArea.id], excluded: [] };
    expect(renderSwitcher().root.findByType('CompactText' as never).props.children).toBe('Home');

    areaFilterState.selection = { included: [homeArea.id, workArea.id], excluded: [] };
    expect(renderSwitcher().root.findByType('CompactText' as never).props.children).toBe('2');
  });

  it('marks the excluded side of the trigger so it cannot read as an inclusion', () => {
    areaFilterState.selection = { included: [], excluded: [homeArea.id] };
    expect(renderSwitcher().root.findByType('CompactText' as never).props.children).toBe('−1');

    areaFilterState.selection = { included: [workArea.id], excluded: [homeArea.id] };
    expect(renderSwitcher().root.findByType('CompactText' as never).props.children).toBe('1 −1');
  });

  it('names the included and excluded areas for the screen reader and the sheet header', () => {
    areaFilterState.selection = { included: [workArea.id], excluded: [homeArea.id] };
    const tree = renderSwitcher();
    const summary = 'Work · Excluded: Home';

    const trigger = tree.root.findAll((node) => String(node.type) === 'Pressable'
      && String(node.props.accessibilityLabel ?? '').startsWith('projects.areaFilter'))[0];
    expect(trigger.props.accessibilityLabel).toBe(`projects.areaFilter: ${summary}`);
    expect(tree.root.findAll((node) => (
      String(node.type) === 'Text' && node.props.children === summary
    ))).toHaveLength(1);
  });

  it('announces an excluded row as mixed rather than merely unselected', () => {
    areaFilterState.selection = { included: [homeArea.id], excluded: [workArea.id] };
    const tree = renderSwitcher();
    const rowFor = (label: string) => tree.root.findAll((node) => (
      String(node.type) === 'TouchableOpacity'
      && String(node.props.accessibilityLabel ?? '').startsWith(label)
    ))[0];

    expect(rowFor('Home').props.accessibilityState).toEqual({ checked: true });
    expect(rowFor('Work').props.accessibilityState).toEqual({ checked: 'mixed' });
  });
});
