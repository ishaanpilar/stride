import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

const speech = vi.hoisted(() => ({
    resolveSpeechCapture: vi.fn(),
    processAudioCapture: vi.fn(),
}));
const audio = vi.hoisted(() => ({ startAudioCapture: vi.fn() }));

vi.mock('../../contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('../../lib/speech-to-text', () => speech);
vi.mock('../../lib/audio-capture', async (original) => ({
    ...(await original<typeof import('../../lib/audio-capture')>()),
    startAudioCapture: audio.startAudioCapture,
}));
vi.mock('../../lib/runtime', async (original) => ({
    ...(await original<typeof import('../../lib/runtime')>()),
    isTauriRuntime: () => true,
}));

import { CaptureComposer } from './CaptureComposer';
import { resetCapturePreferencesForTests, setCapturePreferences } from '../../lib/capture-preferences';

const ready = { ready: true, config: { provider: 'whisper', model: 'base', modelPath: '/m', mode: 'smart_parse', fieldStrategy: 'smart' } };
const notReady = { ready: false, reason: 'disabled', config: { provider: 'whisper', model: 'base' } };

const makeSession = () => ({
    backend: 'native' as const,
    stop: vi.fn().mockResolvedValue({ path: '/tmp/a.wav', name: 'a.wav', mimeType: 'audio/wav', bytes: async () => new Uint8Array([1, 2]) }),
    cancel: vi.fn().mockResolvedValue(undefined),
});

describe('CaptureComposer', () => {
    beforeEach(() => {
        localStorage.clear();
        resetCapturePreferencesForTests();
        speech.resolveSpeechCapture.mockReset().mockResolvedValue(notReady);
        speech.processAudioCapture.mockReset();
        audio.startAudioCapture.mockReset();
    });

    it('Enter saves the line; Shift+Enter does not', async () => {
        const save = vi.fn().mockResolvedValue({ saved: 1, failed: 0, taskIds: ['t1'] });
        const onSaved = vi.fn();
        const { getByRole } = render(<CaptureComposer variant="docked" save={save} onSaved={onSaved} />);
        const input = getByRole('textbox', { name: 'What’s on your mind?' }) as HTMLTextAreaElement;
        fireEvent.change(input, { target: { value: 'Call the dentist' } });
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
        expect(save).not.toHaveBeenCalled();
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(save).toHaveBeenCalledWith('Call the dentist'));
        await waitFor(() => expect(input.value).toBe(''));
        expect(onSaved).toHaveBeenCalledWith({ saved: 1, failed: 0, taskIds: ['t1'] });
    });

    it('multi-line text is announced as several items and saved in one go', async () => {
        const save = vi.fn().mockResolvedValue({ saved: 3, failed: 0, taskIds: ['a', 'b', 'c'] });
        const { getByRole, getByText } = render(<CaptureComposer variant="docked" save={save} />);
        const input = getByRole('textbox', { name: 'What’s on your mind?' });
        fireEvent.change(input, { target: { value: 'milk\n- eggs\n\n3. bread' } });
        expect(getByText('Enter adds 3 items, one per line')).toBeInTheDocument();
        fireEvent.click(getByRole('button', { name: 'Add 3 to Inbox' }));
        await waitFor(() => expect(save).toHaveBeenCalledWith('milk\n- eggs\n\n3. bread'));
    });

    it('shows a disabled mic with the reason when transcription is unavailable', async () => {
        const { getByRole, findByRole } = render(<CaptureComposer variant="docked" save={vi.fn()} />);
        const mic = await findByRole('button', { name: 'Turn on speech to text in Settings → AI to capture by voice.' });
        expect(mic).toHaveAttribute('aria-disabled', 'true');
        expect(mic).toHaveAttribute('title', 'Turn on speech to text in Settings → AI to capture by voice.');
        fireEvent.click(mic);
        expect(audio.startAudioCapture).not.toHaveBeenCalled();
        expect(getByRole('alert')).toHaveTextContent('Turn on speech to text');
    });

    it('records, transcribes with the existing engine, and puts the transcript in the field', async () => {
        speech.resolveSpeechCapture.mockResolvedValue(ready);
        speech.processAudioCapture.mockResolvedValue({ transcript: 'Book the flights to Goa' });
        const session = makeSession();
        audio.startAudioCapture.mockResolvedValue(session);
        const save = vi.fn();
        const { getByRole, findByRole } = render(<CaptureComposer variant="docked" save={save} />);
        const mic = await findByRole('button', { name: 'Record a voice note' });
        await act(async () => { fireEvent.click(mic); });
        const stop = await findByRole('button', { name: 'Stop recording' });
        expect(stop).toHaveAttribute('aria-pressed', 'true');
        // Enter while recording stops (it does not save).
        await act(async () => { fireEvent.keyDown(getByRole('textbox'), { key: 'Enter' }); });
        await waitFor(() => expect((getByRole('textbox') as HTMLTextAreaElement).value).toBe('Book the flights to Goa'));
        expect(speech.processAudioCapture).toHaveBeenCalledWith(
            expect.objectContaining({ path: '/tmp/a.wav', mimeType: 'audio/wav' }),
            expect.objectContaining({ mode: 'transcribe_only', provider: 'whisper' }),
        );
        expect(save).not.toHaveBeenCalled();
    });

    it('auto-saves the transcript when that preference is on', async () => {
        setCapturePreferences({ autoSaveAfterTranscription: true });
        speech.resolveSpeechCapture.mockResolvedValue(ready);
        speech.processAudioCapture.mockResolvedValue({ transcript: 'Renew passport' });
        audio.startAudioCapture.mockResolvedValue(makeSession());
        const save = vi.fn().mockResolvedValue({ saved: 1, failed: 0, taskIds: ['x'] });
        const { findByRole } = render(<CaptureComposer variant="docked" save={save} />);
        const mic = await findByRole('button', { name: 'Record a voice note' });
        await act(async () => { fireEvent.click(mic); });
        const stop = await findByRole('button', { name: 'Stop recording' });
        await act(async () => { fireEvent.click(stop); });
        await waitFor(() => expect(save).toHaveBeenCalledWith('Renew passport'));
    });

    it('explains a denied microphone kindly', async () => {
        speech.resolveSpeechCapture.mockResolvedValue(ready);
        audio.startAudioCapture.mockRejectedValue(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
        const { findByRole, getByRole } = render(<CaptureComposer variant="docked" save={vi.fn()} />);
        const mic = await findByRole('button', { name: 'Record a voice note' });
        await act(async () => { fireEvent.click(mic); });
        await waitFor(() => expect(getByRole('alert')).toHaveTextContent('Privacy & Security → Microphone'));
    });
});
