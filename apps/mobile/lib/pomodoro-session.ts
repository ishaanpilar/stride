// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const POMODORO_SESSION_STORAGE_KEY = '@mindwtr_pomodoro_state';

// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
export const POMODORO_COLLAPSED_STORAGE_KEY = '@mindwtr_pomodoro_collapsed';

export {
  pausePomodoroSession,
  resolvePomodoroSession,
  serializePomodoroSession,
  startPomodoroSession,
  type ResolvedPomodoroSession,
  type StoredPomodoroSession,
} from '@stride/core';
