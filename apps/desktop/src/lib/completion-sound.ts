import { useSyncExternalStore } from 'react';

/**
 * "Completion sound": a very quiet, short tick when the user ticks a task done. Synthesised with
 * WebAudio (no assets). Per device, stored next to the Animations preference; default on. It is
 * independent of Animations. A muted Mac stays silent because the output itself is muted.
 */
export const COMPLETION_SOUND_STORAGE_KEY = 'stride:completion-sound:v1';

let cached: boolean | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function readStored(): boolean {
    try {
        if (typeof localStorage === 'undefined') return true;
        return localStorage.getItem(COMPLETION_SOUND_STORAGE_KEY) !== 'off';
    } catch {
        return true;
    }
}

export function isCompletionSoundEnabled(): boolean {
    if (cached === null) cached = readStored();
    return cached;
}

export function setCompletionSoundEnabled(enabled: boolean): void {
    cached = enabled;
    try {
        if (typeof localStorage !== 'undefined') {
            if (enabled) localStorage.removeItem(COMPLETION_SOUND_STORAGE_KEY);
            else localStorage.setItem(COMPLETION_SOUND_STORAGE_KEY, 'off');
        }
    } catch {
        // Storage unavailable: keep the in-memory value for this session.
    }
    emit();
}

let storageListenerInstalled = false;
const subscribe = (listener: () => void) => {
    if (!storageListenerInstalled && typeof window !== 'undefined') {
        storageListenerInstalled = true;
        // The menu bar panel is another window on the same origin: follow changes made there.
        window.addEventListener('storage', (event) => {
            if (event.key !== null && event.key !== COMPLETION_SOUND_STORAGE_KEY) return;
            cached = readStored();
            emit();
        });
    }
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export function useCompletionSoundEnabled(): [boolean, (enabled: boolean) => void] {
    const enabled = useSyncExternalStore(subscribe, isCompletionSoundEnabled, isCompletionSoundEnabled);
    return [enabled, setCompletionSoundEnabled];
}

type AudioContextCtor = new () => AudioContext;
let context: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
    if (context) return context;
    if (typeof window === 'undefined') return null;
    const Ctor = (window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as AudioContextCtor | undefined;
    if (!Ctor) return null;
    try {
        context = new Ctor();
    } catch {
        context = null;
    }
    return context;
}

/**
 * Creating an AudioContext can block the main thread for a few hundred ms, which would freeze the very
 * animation the sound goes with. So it is created ahead of time, when the browser is idle; it starts
 * suspended (no audio device use) and is resumed for each tick, then suspended again.
 */
export function prewarmCompletionSound(): void {
    if (context || typeof window === 'undefined' || !isCompletionSoundEnabled()) return;
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const create = () => {
        if (!isCompletionSoundEnabled()) return;
        const audio = getAudioContext();
        if (audio && audio.state === 'running') void audio.suspend().catch(() => undefined);
    };
    if (idle) idle(create, { timeout: 4000 });
    else window.setTimeout(create, 1500);
}

let suspendTimer: ReturnType<typeof setTimeout> | null = null;

/** Peak gain of the tick. Deliberately very quiet. */
export const COMPLETION_SOUND_GAIN = 0.05;

/**
 * Plays the tick when the setting is on. Returns true when a sound was scheduled. Never throws.
 * Two soft sine partials a fifth apart, 1.3 kHz then 1.95 kHz, ~140ms with a fast decay: a "tock-tick".
 */
export function playCompletionSound(): boolean {
    if (!isCompletionSoundEnabled()) return false;
    const audio = getAudioContext();
    if (!audio) return false;
    try {
        if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
        const start = audio.currentTime + 0.005;
        const notes: Array<{ freq: number; at: number; length: number; gain: number }> = [
            { freq: 1318.5, at: 0, length: 0.09, gain: COMPLETION_SOUND_GAIN },
            { freq: 1975.5, at: 0.055, length: 0.14, gain: COMPLETION_SOUND_GAIN * 0.8 },
        ];
        for (const note of notes) {
            const osc = audio.createOscillator();
            const gain = audio.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(note.freq, start + note.at);
            gain.gain.setValueAtTime(0.0001, start + note.at);
            gain.gain.exponentialRampToValueAtTime(note.gain, start + note.at + 0.006);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.length);
            osc.connect(gain);
            gain.connect(audio.destination);
            osc.start(start + note.at);
            osc.stop(start + note.at + note.length + 0.02);
        }
        if (suspendTimer !== null) clearTimeout(suspendTimer);
        suspendTimer = setTimeout(() => {
            suspendTimer = null;
            if (audio.state === 'running') void audio.suspend().catch(() => undefined);
        }, 1500);
        return true;
    } catch {
        return false;
    }
}

/** Test helper. */
export function resetCompletionSoundForTests(): void {
    cached = null;
    context = null;
    if (suspendTimer !== null) clearTimeout(suspendTimer);
    suspendTimer = null;
}
