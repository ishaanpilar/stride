import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from '../store';
import type { StorageAdapter } from '../storage';
import { mergeAppData } from '../sync';
import type { AppData, Area } from '../types';

const BASE_NOW = '2026-11-05T12:00:00.000Z';

describe('area context store actions', () => {
    let saveData: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        saveData = vi.fn().mockResolvedValue(undefined);
        const storage: StorageAdapter = {
            getData: vi.fn().mockResolvedValue({ tasks: [], projects: [], sections: [], areas: [], settings: {} }),
            saveData,
        };
        setStorageAdapter(storage);
        useTaskStore.setState({
            tasks: [], projects: [], sections: [], areas: [], settings: {}, isLoading: false, error: null,
            _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [],
            _tasksById: new Map(), _projectsById: new Map(), _sectionsById: new Map(), _areasById: new Map(),
            lastDataChangeAt: 0,
        });
        vi.useFakeTimers();
        vi.setSystemTime(new Date(BASE_NOW));
    });

    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const latestSavedAreas = async (): Promise<Area[]> => {
        await flushPendingSave();
        return (saveData.mock.calls.at(-1)?.[0] as AppData).areas;
    };

    it('creates an area with normalized context and keeps plain areas free of context keys', async () => {
        const { addArea } = useTaskStore.getState();
        const plain = (await addArea('Mad Dog'))!;
        expect(Object.keys(plain)).not.toContain('description');
        const rich = (await addArea('Frackly Works', { description: '  3D printing  ', keywords: ['Printstick', 'printstick'], peopleIds: [] }))!;
        expect(rich.description).toBe('3D printing');
        expect(rich.keywords).toEqual(['Printstick']);
        expect('peopleIds' in rich).toBe(false);
        const saved = await latestSavedAreas();
        expect(saved.find((a) => a.name === 'Frackly Works')?.keywords).toEqual(['Printstick']);
    });

    it('updates context without touching name, colour or projects, and can clear it', async () => {
        const { addArea, addProject, updateArea } = useTaskStore.getState();
        const area = (await addArea('Frackly Works', { color: '#3b82f6' }))!;
        const project = (await addProject('Printstick v2', '#3b82f6', { areaId: area.id }))!;
        const projectRev = useTaskStore.getState()._allProjects.find((p) => p.id === project.id)!.rev;
        const result = await updateArea(area.id, { description: 'Creative direction for a 3D printing company.', keywords: ['Printstick'], peopleIds: ['p1', 'p1'] });
        expect(result.success).toBe(true);
        const updated = useTaskStore.getState()._allAreas.find((a) => a.id === area.id)!;
        expect(updated).toMatchObject({ name: 'Frackly Works', color: '#3b82f6', description: 'Creative direction for a 3D printing company.', keywords: ['Printstick'], peopleIds: ['p1'] });
        expect(updated.rev).toBeGreaterThan(area.rev ?? 0);
        expect(useTaskStore.getState()._allProjects.find((p) => p.id === project.id)!.rev).toBe(projectRev);
        await updateArea(area.id, { description: '   ', keywords: [] });
        const cleared = useTaskStore.getState()._allAreas.find((a) => a.id === area.id)!;
        expect(cleared.description).toBeUndefined();
        expect(cleared.keywords).toBeUndefined();
        expect(cleared.peopleIds).toEqual(['p1']);
    });

    it('syncs context with the newer revision winning (last writer wins per area)', () => {
        const base: Area = { id: 'a1', name: 'Frackly Works', order: 0, createdAt: BASE_NOW, updatedAt: BASE_NOW, rev: 1 };
        const local: AppData = { tasks: [], projects: [], sections: [], areas: [{ ...base, description: 'old', rev: 1 }], people: [], settings: {} } as AppData;
        const incoming: AppData = { ...local, areas: [{ ...base, description: 'new', keywords: ['Printstick'], rev: 2, updatedAt: '2026-11-05T13:00:00.000Z' }] } as AppData;
        const merged = mergeAppData(local, incoming);
        expect(merged.areas[0]).toMatchObject({ description: 'new', keywords: ['Printstick'] });
    });
});
