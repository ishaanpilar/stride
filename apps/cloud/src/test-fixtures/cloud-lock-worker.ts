import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { createWriteLockRunner } from '../server-storage';

const [mode, dataDir, signalPath, rawIterations] = process.argv.slice(2);
if (!mode || !dataDir || !signalPath) {
    throw new Error('Usage: cloud-lock-worker <hold|acquire|increment> <data-dir> <signal-path> [iterations]');
}

const withWriteLock = createWriteLockRunner(dataDir);

if (mode === 'hold') {
    await withWriteLock('cross-process-test', async () => {
        writeFileSync(signalPath, 'ready');
        await new Promise<never>(() => undefined);
    });
} else if (mode === 'acquire') {
    await withWriteLock('cross-process-test', async () => {
        writeFileSync(signalPath, 'acquired');
    });
} else if (mode === 'increment') {
    const iterations = Number(rawIterations ?? 1);
    const counterPath = join(dataDir, 'cross-process-counter.txt');
    for (let index = 0; index < iterations; index += 1) {
        await withWriteLock('cross-process-test', async () => {
            const current = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0;
            await new Promise((resolve) => setTimeout(resolve, 2));
            writeFileSync(counterPath, String(current + 1));
        });
    }
    writeFileSync(signalPath, 'done');
} else {
    throw new Error(`Unknown cloud lock worker mode: ${mode}`);
}
