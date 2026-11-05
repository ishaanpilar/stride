import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTING_CORRECTIONS_STORAGE_KEY, useTaskStore, type Area, type ChangeEntry, type Task } from '@stride/core';
import {
    buildDesktopRoutingContext,
    isAiPlacementTracked,
    loadRoutingCorrections,
    resetAiRoutingTrackerForTests,
    syncAssistantPlacements,
    trackAiPlacement,
} from './ai-routing';

const initialTaskState = useTaskStore.getState();
const T = '2026-11-05T09:00:00.000Z';
const areas: Area[] = [
    { id: 'a-mauvi', name: 'Mauvi Labs', order: 0, createdAt: T, updatedAt: T, description: 'Design studio.' },
    { id: 'a-prad', name: 'Prad', order: 1, createdAt: T, updatedAt: T },
];
const task = (overrides: Partial<Task> = {}): Task => ({
    id: 't1', title: 'Send quotation to Akash', status: 'next', tags: [], contexts: [], createdAt: T, updatedAt: T, ...overrides,
});
const setTasks = (tasks: Task[]) => useTaskStore.setState({ _allTasks: tasks, tasks });

describe('AI routing corrections (desktop)', () => {
    beforeEach(() => {
        localStorage.clear();
        resetAiRoutingTrackerForTests();
        useTaskStore.setState(initialTaskState, true);
        useTaskStore.setState({ _allAreas: areas, areas, _allProjects: [], projects: [], people: [] });
        setTasks([task({ areaId: 'a-prad' })]);
    });
    afterEach(() => resetAiRoutingTrackerForTests());

    it('records a correction when the user moves an AI-placed task to another area', () => {
        trackAiPlacement('t1', { title: 'Send quotation to Akash', areaId: 'a-prad' });
        setTasks([task({ areaId: 'a-mauvi' })]);
        expect(loadRoutingCorrections()).toEqual([
            expect.objectContaining({ text: 'Send quotation to Akash', fromArea: 'Prad', toArea: 'Mauvi Labs' }),
        ]);
        expect(isAiPlacementTracked('t1')).toBe(false);
        // The corrections feed the routing context.
        expect(buildDesktopRoutingContext()).toContain("'Send quotation to Akash' belongs in Mauvi Labs (not Prad)");
    });

    it('ignores unrelated edits, deletions and moves to nowhere', () => {
        trackAiPlacement('t1', { title: 'Send quotation to Akash', areaId: 'a-prad' });
        setTasks([task({ areaId: 'a-prad', title: 'Renamed' })]);
        expect(isAiPlacementTracked('t1')).toBe(true);
        setTasks([task({ areaId: undefined })]);
        expect(localStorage.getItem(ROUTING_CORRECTIONS_STORAGE_KEY)).toBeNull();
        trackAiPlacement('t1', { title: 'x', areaId: 'a-prad' });
        setTasks([task({ areaId: 'a-mauvi', deletedAt: T })]);
        expect(loadRoutingCorrections()).toEqual([]);
    });

    it('tracks routed Assistant changes and forgets them when the change is undone', () => {
        const entry: ChangeEntry = {
            id: 'e1', messageId: 'm1', toolName: 'add_task', label: "Added 'Send quotation to Akash'", at: T, undone: false,
            reason: 'mentions Akash', undoOps: [], changes: [{ taskId: 't1', title: 'Send quotation to Akash', before: {}, after: { areaId: 'a-prad' } }],
        };
        syncAssistantPlacements([entry]);
        expect(isAiPlacementTracked('t1')).toBe(true);
        syncAssistantPlacements([{ ...entry, undone: true }]);
        expect(isAiPlacementTracked('t1')).toBe(false);
        setTasks([task({ areaId: 'a-mauvi' })]);
        expect(loadRoutingCorrections()).toEqual([]);
    });
});
