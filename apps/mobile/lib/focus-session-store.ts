import { useSyncExternalStore } from 'react';

export type FocusPresentation = 'full' | 'mini';

export type FocusSessionUiState = {
    open: boolean;
    presentation: FocusPresentation;
    dismissed: boolean;
};

const CLOSED: FocusSessionUiState = { open: false, presentation: 'full', dismissed: false };

let state: FocusSessionUiState = CLOSED;
const listeners = new Set<() => void>();

const set = (next: FocusSessionUiState) => {
    if (next.open === state.open && next.presentation === state.presentation && next.dismissed === state.dismissed) return;
    state = next;
    listeners.forEach((listener) => listener());
};

export const focusSessionStore = {
    getSnapshot: (): FocusSessionUiState => state,
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    },
    open(presentation: FocusPresentation) {
        set({ open: true, presentation, dismissed: false });
    },
    expand() {
        if (state.open) set({ ...state, presentation: 'full' });
    },
    minimise() {
        if (state.open) set({ ...state, presentation: 'mini' });
    },
    close() {
        set({ open: false, presentation: 'full', dismissed: true });
    },
    clearDismissed() {
        set({ ...state, dismissed: false });
    },
    reset() {
        set(CLOSED);
    },
};

export const useFocusSessionUi = (): FocusSessionUiState => (
    useSyncExternalStore(focusSessionStore.subscribe, focusSessionStore.getSnapshot, focusSessionStore.getSnapshot)
);
