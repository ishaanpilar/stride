import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SETTINGS_FEEDBACK_FILES = [
    './useSyncSettings.ts',
    './useAiSettings.ts',
    './useCalendarSettings.ts',
    './SettingsGtdPage.tsx',
] as const;

describe('desktop Settings feedback localization ratchet', () => {
    it.each(SETTINGS_FEEDBACK_FILES)('%s has no direct English visible-feedback literals', (relativePath) => {
        const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
        const directLiteralCalls = source.match(
            /\b(?:showToast|setSyncError|setCalendarError|setSpeechDownloadError)\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`)/g,
        ) ?? [];
        const indirectLiteralCalls = source.match(
            /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*;\s*\b(?:showToast|setSyncError|setCalendarError|setSpeechDownloadError)\(\s*\1\b/g,
        ) ?? [];

        expect(directLiteralCalls).toEqual([]);
        expect(indirectLiteralCalls).toEqual([]);
        expect(source).not.toMatch(/\breportError\(/);
    });
});
