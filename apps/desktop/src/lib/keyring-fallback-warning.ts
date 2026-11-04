export const KEYRING_FALLBACK_WARNING_EVENT = 'keyring-fallback-warning';

const ALLOWED_CREDENTIAL_LABELS = new Set([
    'OpenAI API key',
    'Anthropic API key',
    'Gemini API key',
    'WebDAV password',
    'Cloud token',
    'Dropbox credentials',
    'Dropbox recovery credentials',
]);

const GENERIC_WARNING = (
    'A credential is stored in plaintext because the system keyring is unavailable.'
);

export function formatKeyringFallbackWarning(payload: unknown): string {
    if (typeof payload !== 'string') return GENERIC_WARNING;
    const match = /^(.+) stored in plaintext because the system keyring is unavailable\.$/.exec(
        payload.trim(),
    );
    const label = match?.[1];
    if (!label || !ALLOWED_CREDENTIAL_LABELS.has(label)) return GENERIC_WARNING;
    return `${label} stored in plaintext because the system keyring is unavailable.`;
}

type NativeEventApi = {
    listen: (
        eventName: string,
        handler: (event: { payload: unknown }) => void,
    ) => Promise<() => void>;
};

type KeyringFallbackWarningListenerOptions = {
    onWarning: (message: string) => void;
    onError?: (error: unknown) => void;
    loadEventApi?: () => Promise<NativeEventApi>;
};

const loadNativeEventApi = async (): Promise<NativeEventApi> => {
    const { listen } = await import('@tauri-apps/api/event');
    return {
        listen: (eventName, handler) => listen<unknown>(eventName, handler),
    };
};

export function installKeyringFallbackWarningListener(
    options: KeyringFallbackWarningListenerOptions,
): () => void {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void (options.loadEventApi ?? loadNativeEventApi)()
        .then((api) => api.listen(KEYRING_FALLBACK_WARNING_EVENT, (event) => {
            if (disposed) return;
            options.onWarning(formatKeyringFallbackWarning(event.payload));
        }))
        .then((nextUnlisten) => {
            if (disposed) {
                nextUnlisten();
                return;
            }
            unlisten = nextUnlisten;
        })
        .catch((error) => {
            if (!disposed) options.onError?.(error);
        });

    return () => {
        disposed = true;
        unlisten?.();
        unlisten = null;
    };
}
