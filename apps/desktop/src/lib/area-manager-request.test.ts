import { describe, expect, it, vi } from 'vitest';
import { consumeAreaManagerRequest, requestAreaManager, subscribeAreaManagerRequest } from './area-manager-request';

describe('area manager request', () => {
    it('keeps a request until it is consumed once, and notifies a mounted listener', () => {
        expect(consumeAreaManagerRequest()).toBe(false);
        requestAreaManager();
        expect(consumeAreaManagerRequest()).toBe(true);
        expect(consumeAreaManagerRequest()).toBe(false);

        const listener = vi.fn(() => consumeAreaManagerRequest());
        const unsubscribe = subscribeAreaManagerRequest(listener);
        requestAreaManager();
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveReturnedWith(true);
        unsubscribe();
        requestAreaManager();
        expect(listener).toHaveBeenCalledOnce();
        consumeAreaManagerRequest();
    });
});
