/**
 * Lets the sidebar's area switcher ("Manage areas…") open the area manager that lives in the
 * Projects view. The request is kept until the Projects view consumes it, so it works whether
 * the view is already mounted or mounts after navigation.
 */
const EVENT = 'stride:open-area-manager';
let pending = false;

export function requestAreaManager(): void {
    pending = true;
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

/** Returns true (once) when an open request is waiting. */
export function consumeAreaManagerRequest(): boolean {
    const was = pending;
    pending = false;
    return was;
}

export function subscribeAreaManagerRequest(listener: () => void): () => void {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
}
