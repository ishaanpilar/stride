import { useCallback, useEffect, useRef, useState } from 'react';
import { isSandboxMode, useTaskStore, type AiSettings } from '@stride/core';

import { MAX_AUDIO_RECORDING_SECONDS } from '../lib/audio-capture-buffer';
import { AudioCaptureError, startAudioCapture, type AudioCaptureSession } from '../lib/audio-capture';
import { logWarn } from '../lib/app-log';
import { isTauriRuntime } from '../lib/runtime';
import { processAudioCapture, resolveSpeechCapture } from '../lib/speech-to-text';

/**
 * Voice capture for the Inbox composer and the capture bar. Records with the existing audio
 * capture (native on macOS, web fallback) and transcribes with the existing speech-to-text engine
 * and settings (Settings → AI → Speech to text), in transcribe-only mode: the transcript goes back
 * to the composer for a quick edit, nothing is saved here.
 */

export type VoiceUnavailableReason = 'disabled' | 'no-key' | 'no-model' | 'desktop-only' | 'sandbox';
export type VoiceAvailability =
    | { status: 'checking' }
    | { status: 'available' }
    | { status: 'unavailable'; reason: VoiceUnavailableReason };

export type VoiceErrorKind = 'permission' | 'no-microphone' | 'unsupported' | 'empty' | 'failed';
export type VoicePhase = 'idle' | 'starting' | 'recording' | 'transcribing';

export const VOICE_TRANSCRIBE_TIMEOUT_MS = 90_000;

export async function resolveVoiceAvailability(ai: AiSettings | undefined): Promise<VoiceAvailability> {
    if (isSandboxMode()) return { status: 'unavailable', reason: 'sandbox' };
    try {
        const resolved = await resolveSpeechCapture(ai);
        if (!resolved.ready) return { status: 'unavailable', reason: resolved.reason ?? 'disabled' };
        const local = resolved.config.provider === 'whisper' || resolved.config.provider === 'parakeet';
        if (local && !isTauriRuntime()) return { status: 'unavailable', reason: 'desktop-only' };
        return { status: 'available' };
    } catch {
        return { status: 'unavailable', reason: 'disabled' };
    }
}

const classifyError = (error: unknown): VoiceErrorKind => {
    if (error instanceof AudioCaptureError) {
        if (error.reason === 'no-microphone') return 'no-microphone';
        if (error.reason === 'unsupported') return 'unsupported';
    }
    const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : '';
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (name === 'NotAllowedError' || name === 'SecurityError' || /permission|denied|not allowed|not authori[sz]ed/i.test(message)) return 'permission';
    if (name === 'NotFoundError' || /no (input )?device|no microphone/i.test(message)) return 'no-microphone';
    return 'failed';
};

const removeTempAudio = async (path: string | undefined) => {
    if (!path || !isTauriRuntime()) return;
    try {
        const { remove } = await import('@tauri-apps/plugin-fs');
        await remove(path);
    } catch {
        // A leftover temp file is harmless; the audio-captures folder is app-managed.
    }
};

export type UseVoiceCaptureOptions = {
    /** Called with the transcript once transcription finishes (non-empty only). */
    onTranscript: (transcript: string) => void;
};

export function useVoiceCapture({ onTranscript }: UseVoiceCaptureOptions) {
    const ai = useTaskStore((state) => state.settings?.ai);
    const [availability, setAvailability] = useState<VoiceAvailability>({ status: 'checking' });
    const [phase, setPhase] = useState<VoicePhase>('idle');
    const [error, setError] = useState<VoiceErrorKind | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const sessionRef = useRef<AudioCaptureSession | null>(null);
    const generationRef = useRef(0);
    const phaseRef = useRef<VoicePhase>('idle');
    const onTranscriptRef = useRef(onTranscript);
    onTranscriptRef.current = onTranscript;

    const setPhaseBoth = (next: VoicePhase) => {
        phaseRef.current = next;
        setPhase(next);
    };

    useEffect(() => {
        let cancelled = false;
        setAvailability({ status: 'checking' });
        void resolveVoiceAvailability(ai).then((next) => {
            if (!cancelled) setAvailability(next);
        });
        return () => { cancelled = true; };
    }, [ai]);

    useEffect(() => {
        if (phase !== 'recording') return undefined;
        const started = Date.now();
        setElapsedSeconds(0);
        const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 250);
        return () => window.clearInterval(timer);
    }, [phase]);

    const start = useCallback(async () => {
        if (phaseRef.current !== 'idle') return;
        if (availability.status !== 'available') return;
        const generation = ++generationRef.current;
        const isCurrent = () => generationRef.current === generation;
        setError(null);
        setPhaseBoth('starting');
        try {
            const session = await startAudioCapture({ isCurrent });
            if (!isCurrent()) {
                await session.cancel().catch(() => undefined);
                return;
            }
            sessionRef.current = session;
            setPhaseBoth('recording');
        } catch (err) {
            if (!isCurrent()) return;
            setError(classifyError(err));
            setPhaseBoth('idle');
        }
    }, [availability.status]);

    const cancel = useCallback(async () => {
        generationRef.current += 1;
        const session = sessionRef.current;
        sessionRef.current = null;
        setPhaseBoth('idle');
        if (session) await session.cancel().catch(() => undefined);
    }, []);

    const stop = useCallback(async () => {
        if (phaseRef.current !== 'recording') return;
        const session = sessionRef.current;
        sessionRef.current = null;
        if (!session) {
            setPhaseBoth('idle');
            return;
        }
        const generation = generationRef.current;
        setPhaseBoth('transcribing');
        let path: string | undefined;
        try {
            const capture = await session.stop();
            path = capture.path;
            const bytes = await capture.bytes();
            const { config } = await resolveSpeechCapture(ai);
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), VOICE_TRANSCRIBE_TIMEOUT_MS); });
            const result = await Promise.race([
                processAudioCapture(
                    { bytes, mimeType: capture.mimeType, name: capture.name, path: capture.path },
                    { ...config, mode: 'transcribe_only', now: new Date(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
                ),
                timeout,
            ]).finally(() => { if (timer) clearTimeout(timer); });
            if (generationRef.current !== generation) return;
            const transcript = result?.transcript?.trim() ?? '';
            if (!transcript) {
                setError(result === null ? 'failed' : 'empty');
                return;
            }
            onTranscriptRef.current(transcript);
        } catch (err) {
            if (generationRef.current !== generation) return;
            void logWarn('Voice capture transcription failed', { scope: 'speech', extra: { error: err instanceof Error ? err.name : 'unknown' } });
            setError(classifyError(err));
        } finally {
            void removeTempAudio(path);
            if (generationRef.current === generation) setPhaseBoth('idle');
        }
    }, [ai]);

    // Hard cap on recording length, like Quick Add.
    useEffect(() => {
        if (phase === 'recording' && elapsedSeconds >= MAX_AUDIO_RECORDING_SECONDS) void stop();
    }, [elapsedSeconds, phase, stop]);

    // Release the microphone if the surface unmounts mid-recording.
    useEffect(() => () => {
        generationRef.current += 1;
        const session = sessionRef.current;
        sessionRef.current = null;
        if (session) void session.cancel().catch(() => undefined);
    }, []);

    const toggle = useCallback(() => {
        if (phaseRef.current === 'recording') return stop();
        if (phaseRef.current === 'idle') return start();
        return Promise.resolve();
    }, [start, stop]);

    return {
        availability,
        phase,
        isRecording: phase === 'recording',
        isBusy: phase === 'starting' || phase === 'transcribing',
        elapsedSeconds,
        error,
        clearError: () => setError(null),
        start,
        stop,
        cancel,
        toggle,
    };
}

export const formatRecordingTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};
