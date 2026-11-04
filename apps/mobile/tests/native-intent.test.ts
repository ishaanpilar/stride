import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redirectSystemPath } from '@/app/+native-intent';

const appLogMocks = vi.hoisted(() => ({
    logInfo: vi.fn(async () => null),
}));

vi.mock('@/lib/app-log', () => appLogMocks);
vi.mock('@/lib/widget-launch-routing', () => ({ recordWidgetLaunchRouting: vi.fn() }));

describe('redirectSystemPath', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        appLogMocks.logInfo.mockReset().mockResolvedValue(null);
    });

    it.each([true, false])('routes share-extension handoffs without a competing capture screen (initial=%s)', async (initial) => {
        for (const scheme of ['stride', 'stride-dev']) {
            for (const suffix of ['', '/', '#weburl', '/#text', '#file', '#media']) {
                const path = `${scheme}://dataUrl=${scheme}ShareKey${suffix}`;


                expect(redirectSystemPath({ path, initial })).toBe(initial ? '/inbox' : '');
                await vi.dynamicImportSettled();
            }
        }
        await vi.waitFor(() => expect(appLogMocks.logInfo).toHaveBeenCalledTimes(12));
        expect(appLogMocks.logInfo).toHaveBeenCalledWith('Share handoff routed', {
            scope: 'routing',
            extra: {
                releaseCheck: 'v1.3.1/share-handoff-route',
                stage: 'handoff-routed',
                delivery: initial ? 'cold' : 'warm',
            },
            force: true,
        });
        expect(JSON.stringify(appLogMocks.logInfo.mock.calls)).not.toMatch(/dataUrl|ShareKey|stride:\/\//);
    });

    it.each([true, false])('leaves share handoff lookalikes untouched (initial=%s)', (initial) => {
        for (const path of [
            'https://dataUrl=strideShareKey/',
            'other://dataUrl=strideShareKey/',
            'stride://dataUrl=',
            'stride://dataUrl=otherShareKey/',
            'stride://dataUrl=strideShareKey/extra',
            'stride://dataUrl=strideShareKey@example.com/',
            'stride://dataUrl=strideShareKey:443/',
            'stride://dataUrl=strideShareKey/?secret=value',
            'stride://unrelated?dataUrl=strideShareKey',
            '/dataUrl=strideShareKey/',
        ]) {
            expect(redirectSystemPath({ path, initial })).toBe(path);
        }
        expect(appLogMocks.logInfo).not.toHaveBeenCalled();
    });

    it.each(['throw', 'reject'] as const)('routes shares even when diagnostics %s', async (failure) => {
        appLogMocks.logInfo.mockImplementationOnce(() => {
            if (failure === 'throw') throw new Error('logger unavailable');
            return Promise.reject(new Error('logger unavailable'));
        });
        expect(redirectSystemPath({ path: 'stride://dataUrl=strideShareKey/', initial: true })).toBe('/inbox');
        await vi.waitFor(() => expect(appLogMocks.logInfo).toHaveBeenCalledOnce());
    });

    it.each([true, false])('routes the Dropbox host callback to Sync settings without exposing OAuth data (initial=%s)', async (initial) => {
        const path = 'stride://redirect/?code=private-code&state=private-state#private-fragment';

        const result = redirectSystemPath({ path, initial });

        expect(result).toBe('/settings?settingsScreen=sync');
        expect(result).not.toContain('private-code');
        expect(result).not.toContain('private-state');
        await vi.waitFor(() => expect(appLogMocks.logInfo).toHaveBeenCalledTimes(1));
        expect(appLogMocks.logInfo).toHaveBeenCalledWith('Dropbox OAuth callback routed', {
            scope: 'routing',
            extra: {
                releaseCheck: 'v1.3.0/dropbox-oauth-route',
                stage: 'callback-routed',
            },
            force: true,
        });
        const diagnostic = JSON.stringify(appLogMocks.logInfo.mock.calls);
        expect(diagnostic).not.toContain('private-code');
        expect(diagnostic).not.toContain('private-state');
        expect(diagnostic).not.toContain('private-fragment');
        expect(diagnostic).not.toContain('stride://');
    });

    it.each([
        'stride://redirect',
        'stride://redirect/',
        'stride://redirect/?error=access_denied&error_description=cancelled',
        'stride:///redirect?code=authorization-code&state=oauth-state',
        'stride:///redirect/',
    ])('routes empty, cancelled, and path-form Dropbox callback %s to Sync settings', async (path) => {
        expect(redirectSystemPath({ path, initial: true })).toBe('/settings?settingsScreen=sync');
        await vi.waitFor(() => expect(appLogMocks.logInfo).toHaveBeenCalledTimes(1));
    });

    it('rejects Dropbox callback lookalikes and leaves them untouched', () => {
        for (const path of [
            'stride-dev://redirect/?code=value',
            'https://redirect/?code=value',
            'stride://redirect.example/?code=value',
            'stride://user@redirect/?code=value',
            'stride://redirect:443/?code=value',
            'stride://redirect/extra?code=value',
            'stride://redirect/extra/..?code=value',
            'stride:///extra/../redirect?code=value',
            'stride:/redirect?code=value',
            'stride://@redirect?code=value',
            'stride://redirect:?code=value',
            'stride://redirect/%2e%2e?code=value',
            'stride:///redirect/extra?code=value',
            'stride:///Redirect?code=value',
        ]) {
            expect(redirectSystemPath({ path, initial: false })).toBe(path);
        }
        expect(appLogMocks.logInfo).not.toHaveBeenCalled();
    });

    it('keeps routing deterministic when the diagnostic logger fails', async () => {
        appLogMocks.logInfo.mockRejectedValueOnce(new Error('logger unavailable'));

        expect(redirectSystemPath({ path: 'stride://redirect/?code=secret', initial: true }))
            .toBe('/settings?settingsScreen=sync');
        await vi.waitFor(() => expect(appLogMocks.logInfo).toHaveBeenCalledTimes(1));
    });

    it('rewrites host-form open-feature links to the destination route', () => {
        expect(redirectSystemPath({ path: 'stride://open-feature?feature=inbox', initial: true })).toBe('/inbox');
        expect(redirectSystemPath({ path: 'stride://open-feature?feature=projects', initial: false })).toBe('/projects');
        expect(redirectSystemPath({ path: 'stride://open-feature?feature=review', initial: false })).toBe('/review-tab');
    });

    it('rewrites path-form open-feature links to the destination route', () => {
        expect(redirectSystemPath({ path: 'stride:///open-feature?feature=focus', initial: true })).toBe('/focus');
        expect(redirectSystemPath({ path: 'stride:///open-feature?feature=calendar', initial: false })).toBe('/calendar');
    });

    it('falls back to inbox for unknown or missing features', () => {
        expect(redirectSystemPath({ path: 'stride://open-feature?feature=nonsense', initial: false })).toBe('/inbox');
        expect(redirectSystemPath({ path: 'stride://open-feature', initial: false })).toBe('/inbox');
    });

    it('rewrites entity-open links to inbox so there is no Unmatched Route flash (#1017)', () => {
        expect(redirectSystemPath({ path: 'stride://open?task=abc-123', initial: true })).toBe('/inbox');
        expect(redirectSystemPath({ path: 'stride:///open?project=proj-1', initial: false })).toBe('/inbox');
        expect(redirectSystemPath({ path: 'stride://open?area=area-1', initial: false })).toBe('/inbox');
    });

    it.each([true, false])('routes the detailed launcher into the in-app sheet (initial=%s)', (initial) => {
        expect(redirectSystemPath({ path: 'stride:///capture-quick?mode=text&entry=details', initial }))
            .toBe('/capture-quick?mode=text');
        expect(redirectSystemPath({ path: 'stride://capture-quick?entry=details&mode=audio&title=ignored', initial }))
            .toBe('/capture-quick?mode=text');
        expect(redirectSystemPath({ path: 'stride:///capture-quick?entry=unknown', initial }))
            .toBe('/capture-modal?origin=system');
    });

    it('routes widget and system quick capture links through the reliable root modal', () => {
        expect(redirectSystemPath({ path: 'stride:///capture-quick?mode=text', initial: true }))
            .toBe('/capture-modal?origin=system');
        expect(redirectSystemPath({ path: 'stride://capture-quick?mode=text', initial: false }))
            .toBe('/capture-modal?origin=system');
        expect(redirectSystemPath({ path: 'stride://capture-quick', initial: true }))
            .toBe('/capture-modal?origin=system');
    });


    it('logs a Control Center quick capture, and only that one', async () => {
        expect(redirectSystemPath({ path: 'stride:///capture-quick?mode=text', initial: true }))
            .toBe('/capture-modal?origin=system');
        await vi.dynamicImportSettled();
        expect(appLogMocks.logInfo).not.toHaveBeenCalled();

        expect(redirectSystemPath({ path: 'stride:///capture-quick?mode=text&source=control', initial: true }))
            .toBe('/capture-modal?origin=system');
        await vi.waitFor(() => expect(appLogMocks.logInfo).toHaveBeenCalledTimes(1));
        expect(appLogMocks.logInfo).toHaveBeenCalledWith('Control Center quick capture routed', {
            scope: 'routing',
            extra: {
                releaseCheck: 'v1.3.2/ios-control-capture',
                stage: 'capture-routed',
                delivery: 'cold',
            },
            force: true,
        });
    });

    it.each([true, false])('keeps shortcut links off the blank capture tab (initial=%s)', (initial) => {
        for (const path of [
            'stride://capture?title=Buy%20milk',
            'stride:///capture?title=Buy%20milk&requestId=first',
            'stride://capture',
        ]) {
            expect(redirectSystemPath({ path, initial })).toBe('/inbox');
        }
    });

    it('leaves unrelated links and internal capture navigation untouched', () => {
        expect(redirectSystemPath({ path: '/capture', initial: false })).toBe('/capture');
        expect(redirectSystemPath({ path: 'https://example.com/capture?title=Buy', initial: false }))
            .toBe('https://example.com/capture?title=Buy');
        expect(redirectSystemPath({ path: '/inbox', initial: true })).toBe('/inbox');
        expect(redirectSystemPath({ path: 'not a url', initial: false })).toBe('not a url');
    });
});
