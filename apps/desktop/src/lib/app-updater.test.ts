import { describe, expect, it } from 'vitest';

import {
    classifyUpdaterError,
    formatUpdateBytes,
    supportsInAppUpdates,
    toReleaseNotesMarkdown,
} from './app-updater';
import type { InstallSource } from './update-service';

describe('supportsInAppUpdates', () => {
    it('enables the signed updater for direct GitHub installs on macOS', () => {
        expect(supportsInAppUpdates('direct', 'macos')).toBe(true);
        expect(supportsInAppUpdates('github-release', 'macos')).toBe(true);
    });

    it('leaves store and package-manager installs on their existing update path', () => {
        const managed: InstallSource[] = [
            'mac-app-store', 'homebrew', 'microsoft-store', 'winget', 'scoop', 'chocolatey',
            'aur', 'aur-bin', 'aur-source', 'flatpak', 'snap', 'apt', 'rpm', 'portable', 'unknown',
        ];
        for (const source of managed) {
            expect(supportsInAppUpdates(source, 'macos')).toBe(false);
        }
        expect(supportsInAppUpdates(null, 'macos')).toBe(false);
    });

    it('enables the updater for direct GitHub installs on Windows x64', () => {
        expect(supportsInAppUpdates('direct', 'windows')).toBe(true);
        expect(supportsInAppUpdates('github-release', 'windows')).toBe(true);
        for (const source of ['microsoft-store', 'winget', 'scoop', 'chocolatey', 'portable'] as InstallSource[]) {
            expect(supportsInAppUpdates(source, 'windows')).toBe(false);
        }
    });

    it('keeps Linux on the reminder until its targets ship in latest.json', () => {
        expect(supportsInAppUpdates('appimage', 'linux')).toBe(false);
        expect(supportsInAppUpdates('direct', 'linux')).toBe(false);
    });
});

describe('classifyUpdaterError', () => {
    it.each([
        ['error sending request for url', 'offline'],
        ['operation timed out', 'offline'],
        [new Error('minisign_verify error: signature mismatch'), 'signature'],
        ['The signature verification failed', 'signature'],
        ['HTTP status 403: API rate limit exceeded', 'rate-limited'],
        ['Could not fetch a valid release JSON from the remote', 'unavailable'],
        ['the platform `darwin-x86_64` was not found in the response `platforms` object', 'unavailable'],
        ['something odd', 'unknown'],
    ])('classifies %s as %s', (error, kind) => {
        expect(classifyUpdaterError(error)).toBe(kind);
    });
});

describe('release notes helpers', () => {
    it('keeps markdown text but strips links, images, html and comments', () => {
        const notes = '<!-- hidden -->\n## New\n- See [the docs](https://example.com) ![shot](x.png)\n<b>bold</b>';
        expect(toReleaseNotesMarkdown(notes)).toBe('## New\n- See the docs \nbold');
    });

    it('formats byte counts', () => {
        expect(formatUpdateBytes(512)).toBe('512 B');
        expect(formatUpdateBytes(2048)).toBe('2 KB');
        expect(formatUpdateBytes(14 * 1024 * 1024)).toBe('14.0 MB');
    });
});
