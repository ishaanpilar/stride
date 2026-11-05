/**
 * Adds or refreshes `<sha256>  <name>` lines in a release's SHA256SUMS.txt (sha256sum format), keyed
 * by file name, keeping every other line. Used by the Release Windows workflow to append the Windows
 * installers (and the updated latest.json) to the checksums the macOS release published.
 *
 *   bun scripts/upsert-sha256sums.ts SHA256SUMS.txt Stride_1.6.0_x64-setup.exe Stride_1.6.0_x64_en-US.msi
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

export function upsertChecksumLines(existing: string, entries: Array<{ name: string; sha256: string }>): string {
    const names = new Set(entries.map((entry) => entry.name));
    const kept = existing
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line && !names.has(line.replace(/^[0-9a-f]{64}\s+\*?/i, '')));
    for (const entry of entries) {
        if (!/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error(`Bad SHA-256 for ${entry.name}.`);
        kept.push(`${entry.sha256}  ${entry.name}`);
    }
    return `${kept.join('\n')}\n`;
}

export function main(argv = process.argv.slice(2)): void {
    const [sumsPath, ...files] = argv;
    if (!sumsPath || files.length === 0) throw new Error('Usage: upsert-sha256sums.ts <SHA256SUMS.txt> <file>...');
    const existing = existsSync(sumsPath) ? readFileSync(sumsPath, 'utf8') : '';
    const entries = files.map((file) => ({
        name: basename(file),
        sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    }));
    writeFileSync(sumsPath, upsertChecksumLines(existing, entries));
    for (const entry of entries) console.log(`${entry.sha256}  ${entry.name}`);
}

if (import.meta.main) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
