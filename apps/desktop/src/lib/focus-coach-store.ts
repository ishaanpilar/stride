import { createFocusCoachStore } from '@stride/core';
import { getWorkspaceCache } from './workspace-cache';

export {
    FOCUS_COACH_FEEDBACK_STORAGE_KEY,
    FOCUS_NOW_STORAGE_KEY,
    addFocusChecklistItems,
    applyFocusCoachAction,
    markFocusTaskDone,
    toLocalStartTime,
    type FocusUndo,
} from '@stride/core';

const store = createFocusCoachStore(getWorkspaceCache);

export const readFocusCoachFeedback = store.readFocusCoachFeedback;
export const recordFocusCoachFeedback = store.recordFocusCoachFeedback;
export const readFocusCoachFeedbackSummary = store.readFocusCoachFeedbackSummary;
export const writeFocusNow = store.writeFocusNow;
export const readFocusNow = store.readFocusNow;
