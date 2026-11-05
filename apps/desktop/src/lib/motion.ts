import { useSyncExternalStore } from 'react';


export type MotionPreference = 'on' | 'off';

export const MOTION_STORAGE_KEY = 'stride:motion:v1';
export const DEFAULT_MOTION_PREFERENCE: MotionPreference = 'on';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Keep in sync with the custom properties at the top of styles/motion.css. */
export const MOTION_DURATION = {
    fast: 140,
    base: 240,
    slow: 360,
    exit: 200,
    /** Height collapses (Collapse, usePresence for disclosure). */
    collapse: 320,
    /** List rows added or removed. */
    list: 300,
} as const;

export const MOTION_EASING = {
    out: 'cubic-bezier(0.16, 1, 0.3, 1)',
    spring: 'cubic-bezier(0.34, 1.45, 0.64, 1)',
    exit: 'cubic-bezier(0.5, 0, 0.75, 0)',
} as const;

export function coerceMotionPreference(value: string | null | undefined): MotionPreference {
    return value === 'off' ? 'off' : DEFAULT_MOTION_PREFERENCE;
}

function readStoredPreference(): MotionPreference {
    try {
        if (typeof localStorage === 'undefined') return DEFAULT_MOTION_PREFERENCE;
        return coerceMotionPreference(localStorage.getItem(MOTION_STORAGE_KEY));
    } catch {
        return DEFAULT_MOTION_PREFERENCE;
    }
}

export function systemPrefersReducedMotion(): boolean {
    try {
        return typeof window !== 'undefined' && window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true;
    } catch {
        return false;
    }
}

export function resolveMotionEnabled(preference: MotionPreference, systemReduced: boolean): boolean {
    return preference === 'on' && !systemReduced;
}

let currentPreference: MotionPreference | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function getMotionPreference(): MotionPreference {
    if (currentPreference === null) currentPreference = readStoredPreference();
    return currentPreference;
}

export type MotionReason = 'on' | 'setting-off' | 'system-reduced';

/**
 * How <html data-motion> is computed: the Animations setting (default on when nothing is
 * stored) AND NOT the system's prefers-reduced-motion (macOS: Accessibility > Display >
 * Reduce motion, which WKWebView reports). The reason is written to data-motion-reason so a
 * silent "off" can always be explained.
 */
export function getMotionDiagnostics(preference: MotionPreference = getMotionPreference()): {
    preference: MotionPreference;
    systemReduced: boolean;
    enabled: boolean;
    reason: MotionReason;
} {
    const systemReduced = systemPrefersReducedMotion();
    const enabled = resolveMotionEnabled(preference, systemReduced);
    const reason: MotionReason = enabled ? 'on' : preference === 'off' ? 'setting-off' : 'system-reduced';
    return { preference, systemReduced, enabled, reason };
}

export function applyMotionPreference(preference: MotionPreference = getMotionPreference()): boolean {
    const { enabled, reason } = getMotionDiagnostics(preference);
    if (typeof document !== 'undefined') {
        const root = document.documentElement;
        root.dataset.motion = enabled ? 'on' : 'off';
        root.dataset.motionPreference = preference;
        root.dataset.motionReason = reason;
    }
    return enabled;
}

const logMotionState = () => {
    const state = getMotionDiagnostics();
    void import('./app-log')
        .then(({ logInfo }) => logInfo('Motion state', { scope: 'ui', extra: state }))
        .catch(() => undefined);
};

export function setMotionPreference(preference: MotionPreference): void {
    currentPreference = preference;
    try {
        if (typeof localStorage !== 'undefined') {
            if (preference === DEFAULT_MOTION_PREFERENCE) localStorage.removeItem(MOTION_STORAGE_KEY);
            else localStorage.setItem(MOTION_STORAGE_KEY, preference);
        }
    } catch {
        currentPreference = preference;
    }
    applyMotionPreference(preference);
    emit();
}

let installed: (() => void) | null = null;

export function installMotionPreference(): () => void {
    currentPreference = readStoredPreference();
    applyMotionPreference(currentPreference);
    if (!installed) logMotionState();
    if (installed) return installed;
    if (typeof window === 'undefined') return () => undefined;

    const onSystemChange = () => {
        applyMotionPreference();
        logMotionState();
        emit();
    };
    const onStorage = (event: StorageEvent) => {
        if (event.key !== null && event.key !== MOTION_STORAGE_KEY) return;
        currentPreference = readStoredPreference();
        applyMotionPreference(currentPreference);
        emit();
    };
    let media: MediaQueryList | null = null;
    try {
        media = window.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
    } catch {
        media = null;
    }
    media?.addEventListener?.('change', onSystemChange);
    window.addEventListener('storage', onStorage);
    installed = () => {
        media?.removeEventListener?.('change', onSystemChange);
        window.removeEventListener('storage', onStorage);
        installed = null;
    };
    return installed;
}

export function isMotionEnabled(): boolean {
    if (typeof document !== 'undefined') {
        const attr = document.documentElement.dataset.motion;
        if (attr === 'off') return false;
    }
    return resolveMotionEnabled(getMotionPreference(), systemPrefersReducedMotion());
}

export function canAnimate(): boolean {
    if (typeof window === 'undefined' || typeof Element === 'undefined') return false;
    if (typeof Element.prototype.animate !== 'function') return false;
    return isMotionEnabled();
}

export function motionDuration(ms: number): number {
    return canAnimate() ? ms : 0;
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export function useMotionPreference(): [MotionPreference, (preference: MotionPreference) => void] {
    const preference = useSyncExternalStore(subscribe, getMotionPreference, getMotionPreference);
    return [preference, setMotionPreference];
}

export function useMotionEnabled(): boolean {
    return useSyncExternalStore(subscribe, isMotionEnabled, isMotionEnabled);
}

export function resetMotionPreferenceForTests(): void {
    installed?.();
    currentPreference = null;
    if (typeof document !== 'undefined') {
        delete document.documentElement.dataset.motion;
        delete document.documentElement.dataset.motionPreference;
        delete document.documentElement.dataset.motionReason;
    }
}

export const SORTABLE_TRANSITION = { duration: 260, easing: MOTION_EASING.out };
