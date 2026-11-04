import { type Project } from '@stride/core';
export { normalizeProjectTag } from '@stride/core';
export { formatProjectDate } from '@stride/core';

export type ProjectStatusPalette = Record<Project['status'], { text: string; bg: string; border: string }>;


export function buildProjectStatusPalette(tc: {
    border: string;
    filterBg: string;
    secondaryText: string;
    tint: string;
}): ProjectStatusPalette {
    return {
        active: { text: tc.tint, bg: `${tc.tint}22`, border: tc.tint },
        waiting: { text: '#F59E0B', bg: '#F59E0B22', border: '#F59E0B' },
        someday: { text: '#A855F7', bg: '#A855F722', border: '#A855F7' },
        archived: { text: tc.secondaryText, bg: tc.filterBg, border: tc.border },
    };
}

export { resolveAttachmentValidationMessage } from '@stride/core';

export function buildProjectQuickCaptureReturnTo(projectId: string) {
    return `/projects-screen?projectId=${encodeURIComponent(projectId)}`;
}


export { getProjectQuickCaptureReturnToProjectId } from '@stride/core/capture-modal-model';
