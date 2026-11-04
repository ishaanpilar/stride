export type SyncCycleOperation<Result> = () => Promise<Result>;

export type SyncCycleExecutor = <Result>(operation: SyncCycleOperation<Result>) => Promise<Result>;

export const createSyncCycleExecutor = (): SyncCycleExecutor => {
    let syncCycleMutex: Promise<void> = Promise.resolve();

    return async <Result>(operation: SyncCycleOperation<Result>): Promise<Result> => {
        const previous = syncCycleMutex;
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        syncCycleMutex = current;
        await previous.catch(() => undefined);
        try {
            return await operation();
        } finally {
            release();
            if (syncCycleMutex === current) {
                syncCycleMutex = Promise.resolve();
            }
        }
    };
};

export const executeSyncCycle = createSyncCycleExecutor();
