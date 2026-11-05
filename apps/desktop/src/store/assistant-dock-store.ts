import { create } from 'zustand';
import { getWorkspaceCache } from '../lib/workspace-cache';

export const ASSISTANT_DOCK_STORAGE_KEY = 'stride:assistant-dock:v1';
export const ASSISTANT_DOCK_DEFAULT_WIDTH = 380;
export const ASSISTANT_DOCK_MIN_WIDTH = 320;
export const ASSISTANT_DOCK_MAX_WIDTH = 560;
/** Below this window width the dock becomes an overlay drawer. */
export const ASSISTANT_DOCK_BREAKPOINT_PX = 1100;

export function clampAssistantDockWidth(value: unknown, fallback = ASSISTANT_DOCK_DEFAULT_WIDTH): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(ASSISTANT_DOCK_MIN_WIDTH, Math.min(ASSISTANT_DOCK_MAX_WIDTH, Math.round(value)))
        : fallback;
}

type Persisted = { open: boolean; width: number };

function readPersisted(): Persisted {
    const fallback: Persisted = { open: true, width: ASSISTANT_DOCK_DEFAULT_WIDTH };
    try {
        const raw = getWorkspaceCache()?.getItem(ASSISTANT_DOCK_STORAGE_KEY);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw) as Partial<Persisted> | null;
        return {
            open: typeof parsed?.open === 'boolean' ? parsed.open : true,
            width: clampAssistantDockWidth(parsed?.width),
        };
    } catch {
        return fallback;
    }
}

function writePersisted(value: Persisted) {
    try {
        getWorkspaceCache()?.setItem(ASSISTANT_DOCK_STORAGE_KEY, JSON.stringify(value));
    } catch {
        // Persistence is best effort.
    }
}

interface AssistantDockState {
    /** Docked open/closed (persisted). */
    open: boolean;
    /** Overlay drawer open (narrow windows; not persisted). */
    drawerOpen: boolean;
    width: number;
    /** True until the panel has focused its composer after a focus request. */
    focusPending: boolean;
    setOpen: (open: boolean) => void;
    setDrawerOpen: (open: boolean) => void;
    setWidth: (width: number) => void;
    /** Open (docked or drawer, depending on `narrow`) and ask the composer to focus. */
    openAndFocus: (narrow?: boolean) => void;
    toggle: (narrow?: boolean) => void;
    consumeFocus: () => void;
    /** Re-read persisted state (tests). */
    reload: () => void;
}

export const useAssistantDockStore = create<AssistantDockState>((set, get) => ({
    ...readPersisted(),
    drawerOpen: false,
    focusPending: false,
    setOpen: (open) => {
        set({ open });
        writePersisted({ open, width: get().width });
    },
    setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
    setWidth: (value) => {
        const width = clampAssistantDockWidth(value);
        set({ width });
        writePersisted({ open: get().open, width });
    },
    openAndFocus: (narrow = false) => {
        if (narrow) set({ drawerOpen: true, focusPending: true });
        else {
            set({ open: true, focusPending: true });
            writePersisted({ open: true, width: get().width });
        }
    },
    toggle: (narrow = false) => {
        if (narrow) set({ drawerOpen: !get().drawerOpen });
        else get().setOpen(!get().open);
    },
    consumeFocus: () => set({ focusPending: false }),
    reload: () => set({ ...readPersisted(), drawerOpen: false, focusPending: false }),
}));
