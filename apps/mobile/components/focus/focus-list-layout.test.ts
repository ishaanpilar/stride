import { describe, expect, it } from 'vitest';
import {
  buildFocusListLayoutFrames,
  collectFocusListLayoutKeys,
  focusItemLayoutKey,
  focusSectionHeaderLayoutKey,
  reconcileFocusListMeasuredHeights,
  FOCUS_ESTIMATED_GROUP_HEADER_HEIGHT,
  FOCUS_ESTIMATED_LIST_HEADER_HEIGHT,
  FOCUS_ESTIMATED_SECTION_HEADER_HEIGHT,
  FOCUS_ESTIMATED_TASK_HEIGHT,
  FOCUS_LIST_HEADER_LAYOUT_KEY,
  type FocusLayoutSection,
} from './focus-list-layout';

const task = (id: string, rev?: number): FocusLayoutSection['data'][number] => ({
  type: 'task',
  task: { id, rev },
});

describe('focus-list-layout (#826)', () => {
  it('emits one frame per SectionList flat index: header, items, zero-height footer', () => {
    const sections: FocusLayoutSection[] = [
      { type: 'focus', totalCount: 2, expanded: true, data: [task('a'), task('b')] },
      { type: 'next', totalCount: 1, expanded: true, data: [task('c')] },
    ];
    const frames = buildFocusListLayoutFrames(sections, {
      measuredHeights: {},
      firstVisibleSectionType: 'focus',
    });

    expect(frames).toHaveLength((2 + 2) + (1 + 2));
    expect(frames[0].offset).toBe(FOCUS_ESTIMATED_LIST_HEADER_HEIGHT);
    expect(frames[0].length).toBe(FOCUS_ESTIMATED_SECTION_HEADER_HEIGHT);
    expect(frames[3].length).toBe(0);
    expect(frames[4].offset).toBe(frames[3].offset);
    expect(frames[6].length).toBe(0);
  });

  it('prefers measured heights and keeps offsets cumulative', () => {
    const sections: FocusLayoutSection[] = [
      { type: 'next', totalCount: 2, expanded: true, data: [task('a', 3), task('b')] },
    ];
    const frames = buildFocusListLayoutFrames(sections, {
      measuredHeights: {
        [FOCUS_LIST_HEADER_LAYOUT_KEY]: 200,
        [focusSectionHeaderLayoutKey(sections[0], true)]: 40,
        [focusItemLayoutKey('next', task('a', 3))]: 120,
      },
      firstVisibleSectionType: 'next',
    });

    expect(frames[0]).toEqual({ length: 40, offset: 200 });
    expect(frames[1]).toEqual({ length: 120, offset: 240 });
    expect(frames[2]).toEqual({ length: FOCUS_ESTIMATED_TASK_HEIGHT, offset: 360 });
  });

  it('gives empty sections a zero-height header slot', () => {
    const sections: FocusLayoutSection[] = [
      { type: 'focus', totalCount: 0, expanded: true, data: [] },
      { type: 'next', totalCount: 1, expanded: true, data: [task('a')] },
    ];
    const frames = buildFocusListLayoutFrames(sections, {
      measuredHeights: {},
      firstVisibleSectionType: 'next',
    });

    expect(frames[0].length).toBe(0);
    expect(frames[1].length).toBe(0);
    expect(frames[2].length).toBe(FOCUS_ESTIMATED_SECTION_HEADER_HEIGHT);
  });

  it('namespaces item keys per section so a task in two sections cannot share a height', () => {
    const item = task('a', 1);
    expect(focusItemLayoutKey('focus', item)).not.toBe(focusItemLayoutKey('next', item));
  });

  it('uses estimates for group headers and re-keys section headers by expanded state and count', () => {
    const sections: FocusLayoutSection[] = [
      {
        type: 'next',
        totalCount: 1,
        expanded: true,
        data: [{ type: 'groupHeader', id: 'ctx:@home', count: 3 }, task('a')],
      },
    ];
    const frames = buildFocusListLayoutFrames(sections, {
      measuredHeights: {},
      firstVisibleSectionType: null,
    });
    expect(frames[1].length).toBe(FOCUS_ESTIMATED_GROUP_HEADER_HEIGHT);

    const expandedKey = focusSectionHeaderLayoutKey(sections[0], false);
    const collapsedKey = focusSectionHeaderLayoutKey({ ...sections[0], expanded: false }, false);
    expect(expandedKey).not.toBe(collapsedKey);
  });

  it('collects the exact key set for pruning stale measurements', () => {
    const sections: FocusLayoutSection[] = [
      { type: 'focus', totalCount: 1, expanded: true, data: [task('a', 2)] },
    ];
    const keys = collectFocusListLayoutKeys(sections, 'focus');
    expect(keys).toEqual(new Set([
      FOCUS_LIST_HEADER_LAYOUT_KEY,
      focusSectionHeaderLayoutKey(sections[0], true),
      focusItemLayoutKey('focus', task('a', 2)),
    ]));
  });

  describe('reconcileFocusListMeasuredHeights', () => {
    it('carries a measurement to the successor key when a revision bump re-keys a row', () => {
      const sections: FocusLayoutSection[] = [
        { type: 'focus', totalCount: 1, expanded: true, data: [task('a', 2)] },
      ];
      const { heights, changed } = reconcileFocusListMeasuredHeights(sections, 'focus', {
        [focusItemLayoutKey('focus', task('a', 1))]: 132,
      });
      expect(changed).toBe(true);
      expect(heights[focusItemLayoutKey('focus', task('a', 2))]).toBe(132);
      expect(heights[focusItemLayoutKey('focus', task('a', 1))]).toBeUndefined();
    });

    it('keeps a fresh measurement over a stale one and drops rows that left the list', () => {
      const sections: FocusLayoutSection[] = [
        { type: 'focus', totalCount: 1, expanded: true, data: [task('a', 2)] },
      ];
      const { heights, changed } = reconcileFocusListMeasuredHeights(sections, 'focus', {
        [focusItemLayoutKey('focus', task('a', 1))]: 132,
        [focusItemLayoutKey('focus', task('a', 2))]: 140,
        [focusItemLayoutKey('focus', task('gone', 1))]: 90,
      });
      expect(changed).toBe(true);
      expect(heights[focusItemLayoutKey('focus', task('a', 2))]).toBe(140);
      expect(heights[focusItemLayoutKey('focus', task('gone', 1))]).toBeUndefined();
      expect(Object.keys(heights)).toHaveLength(1);
    });

    it('reports no change when every measurement key is still active', () => {
      const sections: FocusLayoutSection[] = [
        { type: 'focus', totalCount: 1, expanded: true, data: [task('a', 2)] },
      ];
      const input = { [focusItemLayoutKey('focus', task('a', 2))]: 120 };
      const { heights, changed } = reconcileFocusListMeasuredHeights(sections, 'focus', input);
      expect(changed).toBe(false);
      expect(heights).toEqual(input);
    });

    it('carries group header measurements across count changes despite @ in group ids', () => {
      const group = (count: number): FocusLayoutSection['data'][number] => (
        { type: 'groupHeader', id: 'ctx:@home', count }
      );
      const sections: FocusLayoutSection[] = [
        { type: 'next', totalCount: 1, expanded: true, data: [group(4), task('a')] },
      ];
      const { heights } = reconcileFocusListMeasuredHeights(sections, 'next', {
        [focusItemLayoutKey('next', group(3))]: 52,
      });
      expect(heights[focusItemLayoutKey('next', group(4))]).toBe(52);
    });

    it('carries the section header measurement when its variant changes', () => {
      const section: FocusLayoutSection = { type: 'focus', totalCount: 2, expanded: true, data: [task('a'), task('b')] };
      const { heights } = reconcileFocusListMeasuredHeights([section], 'focus', {
        [focusSectionHeaderLayoutKey({ ...section, totalCount: 1 }, true)]: 44,
      });
      expect(heights[focusSectionHeaderLayoutKey(section, true)]).toBe(44);
    });
  });
});
