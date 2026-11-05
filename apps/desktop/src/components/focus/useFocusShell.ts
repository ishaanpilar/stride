import { usePomodoroStore } from '../../store/pomodoro-store';
import { getFocusShellMode, useFocusSessionStore, type FocusShellMode } from '../../store/focus-session-store';

/** Props for the app shell root: dims the app and makes it inert only while the full stage is up. */
export function useFocusShell(): { mode: FocusShellMode; inert: boolean } {
    const open = useFocusSessionStore((s) => s.open);
    const presentation = useFocusSessionStore((s) => s.presentation);
    const phase = usePomodoroStore((s) => s.snapshot.timerState.phase);
    const mode = getFocusShellMode({ open, presentation }, phase);
    return { mode, inert: mode !== undefined };
}
