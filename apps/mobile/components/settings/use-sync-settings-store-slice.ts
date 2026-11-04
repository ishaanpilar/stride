import {
    shallow,
    useTaskStore,
    type AppData,
} from '@stride/core';

export type SettingsScreenMode = 'sync' | 'data';

const EMPTY_TASKS: AppData['tasks'] = [];
const EMPTY_PROJECTS: AppData['projects'] = [];
const EMPTY_SECTIONS: AppData['sections'] = [];
const EMPTY_AREAS: AppData['areas'] = [];

export function useSyncSettingsStoreSlice(mode: SettingsScreenMode) {
    return useTaskStore((state) => ({
        addTask: state.addTask,
        areas: mode === 'data' ? state.areas : EMPTY_AREAS,
        projects: mode === 'data' ? state.projects : EMPTY_PROJECTS,
        sections: mode === 'data' ? state.sections : EMPTY_SECTIONS,
        seedGettingStarted: state.seedGettingStarted,
        settings: state.settings,
        tasks: mode === 'data' ? state.tasks : EMPTY_TASKS,
        updateSettings: state.updateSettings,
    }), shallow);
}
