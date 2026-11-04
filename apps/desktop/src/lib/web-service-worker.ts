export function registerWebServiceWorker(onOnlineOnly: () => void) {
    const workers = navigator.serviceWorker;
    let reported = false;
    workers.addEventListener('message', (event) => {
        if (!reported && event.source === workers.controller
            && event.data === 'stride-service-worker-online-only') {
            reported = true;
            onOnlineOnly();
        }
    });
    const checkMode = () => workers.controller?.postMessage('stride-service-worker-mode');
    workers.addEventListener('controllerchange', checkMode);
    checkMode();
    void workers.register('/sw.js', { updateViaCache: 'none' }).catch(() => undefined);
}
