import { describe, expect, it } from 'vitest';
import {
    computeProjectAreaDragResult,
    getProjectAreaContainerId,
    getProjectAreaContainerInfo,
    getProjectAreaIdFromContainer,
    projectAreaCollisionDetection,
} from './project-area-dnd';

describe('project-area-dnd', () => {
    it('parses section-namespaced area container ids', () => {
        const id = getProjectAreaContainerId('active', 'area-1');
        expect(id).toBe('project-area:active:area-1');
        expect(getProjectAreaIdFromContainer(id)).toBe('area-1');
        expect(getProjectAreaContainerInfo(id)).toEqual({ section: 'active', areaId: 'area-1' });
        expect(getProjectAreaContainerInfo('project-area:bogus:area-1')).toBeNull();
        expect(getProjectAreaIdFromContainer('other')).toBeNull();
    });

    it('reorders projects within the same area', () => {
        const result = computeProjectAreaDragResult({
            activeId: 'p3',
            overId: 'p1',
            projectIdsByArea: new Map([
                ['a1', ['p1', 'p2', 'p3']],
                ['a2', ['p4']],
            ]),
            projectAreaById: new Map([
                ['p1', 'a1'],
                ['p2', 'a1'],
                ['p3', 'a1'],
                ['p4', 'a2'],
            ]),
        });

        expect(result).toEqual({
            sourceAreaId: 'a1',
            destinationAreaId: 'a1',
            nextSourceIds: ['p3', 'p1', 'p2'],
            nextDestinationIds: ['p3', 'p1', 'p2'],
            movedProjectId: 'p3',
            movedAcrossAreas: false,
        });
    });

    it('moves a project into another area before the hovered project', () => {
        const result = computeProjectAreaDragResult({
            activeId: 'p1',
            overId: 'p4',
            projectIdsByArea: new Map([
                ['a1', ['p1', 'p2']],
                ['a2', ['p3', 'p4']],
            ]),
            projectAreaById: new Map([
                ['p1', 'a1'],
                ['p2', 'a1'],
                ['p3', 'a2'],
                ['p4', 'a2'],
            ]),
        });

        expect(result).toEqual({
            sourceAreaId: 'a1',
            destinationAreaId: 'a2',
            nextSourceIds: ['p2'],
            nextDestinationIds: ['p3', 'p1', 'p4'],
            movedProjectId: 'p1',
            movedAcrossAreas: true,
        });
    });

    it('moves a project into an area that has no projects yet', () => {
        const result = computeProjectAreaDragResult({
            activeId: 'p1',
            overId: getProjectAreaContainerId('active', 'a-empty'),
            projectIdsByArea: new Map([
                ['a1', ['p1', 'p2']],
            ]),
            projectAreaById: new Map([
                ['p1', 'a1'],
                ['p2', 'a1'],
            ]),
        });

        expect(result).toEqual({
            sourceAreaId: 'a1',
            destinationAreaId: 'a-empty',
            nextSourceIds: ['p2'],
            nextDestinationIds: ['p1'],
            movedProjectId: 'p1',
            movedAcrossAreas: true,
        });
    });

    it('prefers project rows over area containers when both are under the pointer', () => {
        const rowRect = { top: 10, left: 0, width: 200, height: 30, bottom: 40, right: 200 };
        const containerRect = { top: 0, left: 0, width: 200, height: 300, bottom: 300, right: 200 };
        const buildContainer = (id: string, rect: typeof rowRect) => ({
            id,
            key: id,
            data: { current: {} },
            disabled: false,
            node: { current: null },
            rect: { current: rect },
        });
        const args = {
            active: { id: 'p9', data: { current: {} }, rect: { current: { initial: rowRect, translated: rowRect } } },
            collisionRect: { ...rowRect },
            droppableRects: new Map([
                ['p1', rowRect],
                [getProjectAreaContainerId('active', 'a1'), containerRect],
            ]),
            droppableContainers: [
                buildContainer('p1', rowRect),
                buildContainer(getProjectAreaContainerId('active', 'a1'), containerRect),
            ],
            pointerCoordinates: { x: 100, y: 25 },
        };

        const collisions = projectAreaCollisionDetection(args as never);
        expect(collisions.map((collision) => String(collision.id))).toEqual(['p1']);
    });

    it('appends a project when dropped on an area container', () => {
        const result = computeProjectAreaDragResult({
            activeId: 'p1',
            overId: getProjectAreaContainerId('active', 'a2'),
            projectIdsByArea: new Map([
                ['a1', ['p1', 'p2']],
                ['a2', ['p3']],
            ]),
            projectAreaById: new Map([
                ['p1', 'a1'],
                ['p2', 'a1'],
                ['p3', 'a2'],
            ]),
        });

        expect(result).toEqual({
            sourceAreaId: 'a1',
            destinationAreaId: 'a2',
            nextSourceIds: ['p2'],
            nextDestinationIds: ['p3', 'p1'],
            movedProjectId: 'p1',
            movedAcrossAreas: true,
        });
    });
});
