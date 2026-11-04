import { describe, expect, it } from 'vitest';

import {
  getTaskGroupCollapseStorageKey,
  readTaskGroupCollapseState,
  serializeTaskGroupCollapseState,
} from './task-group-collapse-state';

describe('task group collapse state', () => {
  it('keys storage per list so two lists cannot overwrite each other', () => {
    expect(getTaskGroupCollapseStorageKey('done')).not.toBe(getTaskGroupCollapseStorageKey('archived'));
  });

  it('round-trips folded ids per axis', () => {
    const state = { area: ['a1', 'general'], tag: ['tag:next'] };
    expect(readTaskGroupCollapseState(serializeTaskGroupCollapseState(state))).toEqual(state);
  });

  it('falls back to nothing folded on missing or malformed storage', () => {
    expect(readTaskGroupCollapseState(null)).toEqual({});
    expect(readTaskGroupCollapseState('not json')).toEqual({});
    expect(readTaskGroupCollapseState('["area"]')).toEqual({});
  });

  it('discards axes that are not lists of ids, so one bad entry cannot hide rows', () => {
    expect(readTaskGroupCollapseState('{"area":"a1","tag":["ok",7],"project":[]}'))
      .toEqual({ tag: ['ok'] });
  });
});
