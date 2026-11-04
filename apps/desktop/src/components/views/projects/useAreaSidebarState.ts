import { useMemo } from 'react';
import { useSensor, useSensors, PointerSensor, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { Area, AppData } from '@stride/core';
import { AREA_FILTER_NONE, areaFilterSelectionToValue, isAreaFilterSelectionActive, resolveAreaFilterSelection, tFallback } from '@stride/core';
import { reportError } from '../../../lib/report-error';
import type { ConfirmationRequestOptions } from '../../../hooks/useConfirmDialog';
import {
    toggleProjectAreaCollapse,
    type ProjectAreaSection,
    type CollapsedProjectAreas,
} from './project-area-collapse';

type UseAreaSidebarStateParams = {
    areas: Area[];
    settings?: AppData['settings'];
    t: (key: string) => string;
    reorderAreas: (ids: string[]) => Promise<void> | void;
    deleteArea: (id: string) => Promise<unknown> | void;
    setCollapsedAreas: React.Dispatch<React.SetStateAction<CollapsedProjectAreas>>;
    requestConfirmation: (options: ConfirmationRequestOptions) => Promise<boolean>;
    showToast?: (message: string, tone?: 'success' | 'error' | 'info', durationMs?: number) => void;
};

export function useAreaSidebarState({
    areas,
    settings,
    t,
    reorderAreas,
    deleteArea,
    setCollapsedAreas,
    requestConfirmation,
    showToast,
}: UseAreaSidebarStateParams) {
    const NO_AREA = AREA_FILTER_NONE;
    const selectedArea = useMemo(
        () => resolveAreaFilterSelection(settings?.filters, areas),
        [settings?.filters, areas],
    );

    const { sortedAreas, areaById } = useMemo(() => {
        const sorted = [...areas].sort((a, b) => a.order - b.order);
        return {
            sortedAreas: sorted,
            areaById: new Map(sorted.map((area) => [area.id, area])),
        };
    }, [areas]);

    const selectedAreaValue = areaFilterSelectionToValue(selectedArea);

    const areaFilterLabel = useMemo(() => {
        if (!isAreaFilterSelectionActive(selectedArea)) return null;
        const nameOf = (id: string) => (id === NO_AREA ? t('projects.noArea') : areaById.get(id)?.name || t('projects.noArea'));
        const included = selectedArea.included.map(nameOf).join(', ');
        const excluded = selectedArea.excluded.length > 0
            ? `${tFallback(t, 'filters.excluded', 'Excluded')}: ${selectedArea.excluded.map(nameOf).join(', ')}`
            : '';
        return [included, excluded].filter(Boolean).join(' · ');
    }, [selectedArea, areaById, NO_AREA, t]);

    const areaSensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 4 },
        }),
    );

    const toggleAreaCollapse = (section: ProjectAreaSection, areaId: string) => {
        setCollapsedAreas((prev) => toggleProjectAreaCollapse(prev, section, areaId));
    };

    const handleAreaDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = sortedAreas.findIndex((area) => area.id === active.id);
        const newIndex = sortedAreas.findIndex((area) => area.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return;
        const reordered = arrayMove(sortedAreas, oldIndex, newIndex).map((area) => area.id);
        void Promise.resolve(reorderAreas(reordered)).catch((error) => {
            reportError('Failed to reorder areas', error);
            showToast?.(tFallback(t, 'projects.areaReorderFailed', 'Failed to reorder areas'), 'error');
        });
    };

    const handleDeleteArea = async (areaId: string) => {
        const areaDeleteConfirm = t('areas.deleteConfirm');
        const confirmed = await requestConfirmation({
            title: t('projects.areaLabel'),
            description: areaDeleteConfirm === 'areas.deleteConfirm'
                ? 'Delete this area? Projects and tasks in this area will be kept and moved to unassigned.'
                : areaDeleteConfirm,
            confirmLabel: tFallback(t, 'common.delete', 'Delete'),
            cancelLabel: tFallback(t, 'common.cancel', 'Cancel'),
        });
        if (confirmed) {
            deleteArea(areaId);
        }
    };

    return {
        selectedArea,
        selectedAreaValue,
        sortedAreas,
        areaById,
        areaFilterLabel,
        areaSensors,
        toggleAreaCollapse,
        handleAreaDragEnd,
        handleDeleteArea,
    };
}
