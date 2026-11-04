import { writeFileSync } from 'fs';

import { startCloudServer } from '../server';

const [dataDir, readyPath] = process.argv.slice(2);
if (!dataDir || !readyPath) {
    throw new Error('Usage: cloud-server-worker <data-dir> <ready-path>');
}

const server = await startCloudServer({
    host: '127.0.0.1',
    port: 0,
    dataDir,
    allowedAuthTokens: null,
    maxAnyTokenNamespaces: 1,
});
writeFileSync(readyPath, String(server.port));

const stop = () => {
    server.stop();
    process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
await new Promise<never>(() => undefined);
