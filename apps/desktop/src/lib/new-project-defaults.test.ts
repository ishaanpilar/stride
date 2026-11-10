import { beforeEach, describe, expect, it } from 'vitest';
import { useTaskStore } from '@stride/core';

import { applyNewProjectDefaults, installNewProjectDefaults, resetNewProjectDefaultsForTests } from './new-project-defaults';

describe('desktop new-project defaults', () => {
    it('defaults a new project to Next action only when nothing was chosen', () => {
        expect(applyNewProjectDefaults(undefined, { gtd: {} })).toEqual({ isSequential: true });
        expect(applyNewProjectDefaults({ areaId: 'a' }, { gtd: {} })).toEqual({ areaId: 'a', isSequential: true });
    });

    it('leaves an explicit choice and a per-section project alone', () => {
        expect(applyNewProjectDefaults({ isSequential: false }, { gtd: {} })).toEqual({ isSequential: false });
        expect(applyNewProjectDefaults({ perSectionFlow: true }, { gtd: {} })).toEqual({ perSectionFlow: true });
    });

    it('defers to the default the user set in Settings', () => {
        expect(applyNewProjectDefaults(undefined, { gtd: { defaultProjectFlowMode: 'parallel' } })).toBeUndefined();
        expect(applyNewProjectDefaults({ areaId: 'a' }, { gtd: { defaultProjectFlowMode: 'sequential' } })).toEqual({ areaId: 'a' });
    });

    describe('installed around the store action', () => {
        const original = useTaskStore.getState().addProject;
        beforeEach(() => {
            resetNewProjectDefaultsForTests();
            useTaskStore.setState({
                addProject: original, projects: [], _allProjects: [], settings: { deviceId: 'd' },
            });
            installNewProjectDefaults();
        });

        it('creates new projects as Next action only, and keeps an explicit parallel one', async () => {
            const defaulted = await useTaskStore.getState().addProject('New', '#123456');
            const parallel = await useTaskStore.getState().addProject('Parallel', '#123456', { isSequential: false });
            expect(defaulted?.isSequential).toBe(true);
            expect(parallel?.isSequential).toBe(false);
        });

        it('leaves existing projects unchanged', async () => {
            const before = await useTaskStore.getState().addProject('Old', '#123456', { isSequential: false });
            await useTaskStore.getState().addProject('New', '#123456');
            expect(useTaskStore.getState()._allProjects.find((project) => project.id === before?.id)?.isSequential).toBe(false);
        });
    });
});
