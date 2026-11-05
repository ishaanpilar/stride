import { create } from 'zustand';

/**
 * Main-window state for the floating focus timer, per session. The timer itself stays in the
 * pomodoro store; this only says whether the user asked for the float, closed it, and whether
 * the native window is currently up.
 */
export type FocusFloatStoreState = {
    /** The user asked for the float this session (Minimise, or a "Float timer" button). */
    requested: boolean;
    /** The user closed the float this session; it stays away until asked for again. */
    closedByUser: boolean;
    /** The native float window is on screen (set after the native call succeeds). */
    visible: boolean;
    request: () => void;
    closeByUser: () => void;
    setVisible: (visible: boolean) => void;
    /** A session ended (or a new one began): forget this session's choices. */
    resetSession: () => void;
};

export const useFocusFloatStore = create<FocusFloatStoreState>((set) => ({
    requested: false,
    closedByUser: false,
    visible: false,
    request: () => set({ requested: true, closedByUser: false }),
    closeByUser: () => set({ closedByUser: true, requested: false }),
    setVisible: (visible) => set({ visible }),
    resetSession: () => set({ requested: false, closedByUser: false }),
}));

/** For buttons outside the focus host: ask for the float (the host decides and shows it). */
export const requestFocusFloat = () => useFocusFloatStore.getState().request();
