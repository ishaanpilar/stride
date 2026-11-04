import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DONE_LIST_VIEW_STATE,
  readDoneListViewState,
  serializeDoneListViewState,
} from './done-list-view-state';

describe('Done list view state', () => {
  it('round-trips its device-local grouping and sort preference', () => {
    const state = { groupBy: 'completedDate', sortBy: 'completed' } as const;
    expect(readDoneListViewState(serializeDoneListViewState(state))).toEqual(state);
  });

  it('drops unknown values without creating a synced setting', () => {
    expect(readDoneListViewState(JSON.stringify({
      groupBy: 'priority',
      sortBy: 'unknown',
    }))).toEqual(DEFAULT_DONE_LIST_VIEW_STATE);
  });
});
