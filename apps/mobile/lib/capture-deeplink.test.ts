import { describe, expect, it } from 'vitest';
import {
    isEntityOpenUrl,
    isOpenFeatureUrl,
    isShortcutCaptureUrl,
    parseEntityOpenUrl,
    parseOpenFeatureUrl,
    parseShortcutCaptureUrl,
    resolveOpenFeaturePath,
} from './capture-deeplink';

describe('capture-deeplink', () => {
    it('parses capture URLs with title, note, project, and tags', () => {
        expect(
            parseShortcutCaptureUrl(
                'stride://capture?title=Buy%20groceries&note=From%20store&project=Shopping&tags=errands,%20home'
            )
        ).toEqual({
            title: 'Buy groceries',
            note: 'From store',
            project: 'Shopping',
            tags: ['errands', 'home'],
        });
    });

    it('accepts triple-slash form and fallback fields', () => {
        expect(parseShortcutCaptureUrl('stride:///capture?text=Pay%20bill&description=Utility')).toEqual({
            title: 'Pay bill',
            note: 'Utility',
            tags: [],
        });
    });

    it('returns null for unsupported URLs', () => {
        expect(parseShortcutCaptureUrl('https://github.com/ishaanpilar/stride')).toBeNull();
        expect(parseShortcutCaptureUrl('stride://focus')).toBeNull();
        expect(parseShortcutCaptureUrl('stride://capture?title=')).toBeNull();
    });

    it('trims values and drops empty tags', () => {
        expect(parseShortcutCaptureUrl('stride://capture?title=%20Task%20&tags=%20alpha%20,%20,%20beta%20')).toEqual({
            title: 'Task',
            tags: ['alpha', 'beta'],
        });
    });

    it('accepts App Actions create-thing parameter names', () => {
        expect(parseShortcutCaptureUrl('stride:///capture?name=Call%20dentist&description=Tomorrow')).toEqual({
            title: 'Call dentist',
            note: 'Tomorrow',
            tags: [],
        });
    });

    it('detects capture routes even when the payload is invalid', () => {
        expect(isShortcutCaptureUrl('stride://capture?title=')).toBe(true);
        expect(isShortcutCaptureUrl('stride:///capture?note=Missing%20title')).toBe(true);
        expect(isShortcutCaptureUrl('stride://focus')).toBe(false);


        expect(isShortcutCaptureUrl('stride:///capture-quick?mode=text')).toBe(false);
        expect(isOpenFeatureUrl('stride:///capture-quick?mode=text')).toBe(false);
        expect(isShortcutCaptureUrl('https://github.com/ishaanpilar/stride')).toBe(false);
    });

    it('parses and resolves App Actions open-feature URLs', () => {
        expect(isOpenFeatureUrl('stride:///open-feature?feature=focus')).toBe(true);
        expect(parseOpenFeatureUrl('stride:///open-feature?feature=waiting')).toEqual({ feature: 'waiting' });
        expect(resolveOpenFeaturePath('today')).toBe('/focus');
        expect(resolveOpenFeaturePath('someday')).toBe('/someday');
        expect(resolveOpenFeaturePath('unknown')).toBe('/inbox');
    });

    it('parses entity-open URLs for task, project, and area (#1017)', () => {
        expect(isEntityOpenUrl('stride://open?task=abc-123')).toBe(true);
        expect(isEntityOpenUrl('stride:///open?project=abc-123')).toBe(true);
        expect(isEntityOpenUrl('stride://open-feature?feature=focus')).toBe(false);
        expect(isEntityOpenUrl('stride://capture?title=x')).toBe(false);

        expect(parseEntityOpenUrl('stride://open?task=abc-123')).toEqual({ kind: 'task', id: 'abc-123' });
        expect(parseEntityOpenUrl('stride:///open?project=proj-1')).toEqual({ kind: 'project', id: 'proj-1' });
        expect(parseEntityOpenUrl('stride://open?area=area-1')).toEqual({ kind: 'area', id: 'area-1' });
    });

    it('returns null for a malformed or empty entity-open URL', () => {
        expect(parseEntityOpenUrl('stride://open')).toBeNull();
        expect(parseEntityOpenUrl('stride://open?task=')).toBeNull();
        expect(parseEntityOpenUrl('https://github.com/ishaanpilar/stride')).toBeNull();
        expect(parseEntityOpenUrl('stride://focus')).toBeNull();
    });
});
