import {
    AREA_FILTER_ALL,
    AREA_FILTER_NONE,
    areaFilterSelectionToValue,
    buildQuickAddParseOptions,
    executeCaptureTransaction,
    getDefaultTaskAreaMode,
    parseQuickAdd,
    resolveAreaFilterSelection,
    resolveDefaultNewTaskAreaId,
    useTaskStore,
    type AppData,
    type Area,
} from '@stride/core';

/**
 * Inline capture: the Capture button, Cmd/Ctrl+K and the menu all go through `openCapture()`.
 * When the Inbox composer is on screen it takes focus in place; anywhere else a compact capture
 * bar opens over the current view. Both save straight to the Inbox, one item per line.
 */

export const CAPTURE_BAR_EVENT = 'stride:capture-bar';
export const MAX_CAPTURE_LINES = 100;

export type OpenCaptureOptions = {
    /** Opened from an explicit capture trigger (button/shortcut): may auto-start voice. */
    fromTrigger?: boolean;
    /** Start recording right away (overrides the setting). */
    voice?: boolean;
};

export type CaptureComposerHandle = {
    focus: (options?: OpenCaptureOptions) => void;
    /** Whether the composer is currently laid out on screen. */
    isVisible: () => boolean;
};

let inboxComposer: CaptureComposerHandle | null = null;

/** The Inbox composer registers itself while mounted; returns the unregister function. */
export function registerInboxComposer(handle: CaptureComposerHandle): () => void {
    inboxComposer = handle;
    return () => {
        if (inboxComposer === handle) inboxComposer = null;
    };
}

export function openCapture(options: OpenCaptureOptions = { fromTrigger: true }): 'inbox' | 'bar' {
    if (inboxComposer && inboxComposer.isVisible()) {
        inboxComposer.focus(options);
        return 'inbox';
    }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent<OpenCaptureOptions>(CAPTURE_BAR_EVENT, { detail: options }));
    }
    return 'bar';
}

/** Split pasted or typed text into capture lines: trims, drops empty lines and list bullets. */
export function splitCaptureLines(text: string): string[] {
    return String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/^\s*(?:[-*•–]|\[ ?\]|\d+[.)])\s+/, '').trim())
        .filter(Boolean)
        .slice(0, MAX_CAPTURE_LINES);
}

/** Same default area as Quick Add: the active area filter ("active" mode) or the fixed default area. */
export function resolveCaptureAreaId(settings: AppData['settings'] | undefined, areas: Area[]): string | undefined {
    if (getDefaultTaskAreaMode(settings) === 'active') {
        const value = areaFilterSelectionToValue(resolveAreaFilterSelection(settings?.filters, areas));
        return value !== AREA_FILTER_ALL && value !== AREA_FILTER_NONE ? value : undefined;
    }
    return resolveDefaultNewTaskAreaId(settings, areas) ?? undefined;
}

export type CaptureSaveResult = { saved: number; failed: number; taskIds: string[] };

/**
 * Add each line to the Inbox. Quick-add syntax (@context, #tag, /due:…) keeps working, but the
 * status is always Inbox. Never throws.
 */
export async function captureLinesToInbox(text: string): Promise<CaptureSaveResult> {
    const lines = splitCaptureLines(text);
    const result: CaptureSaveResult = { saved: 0, failed: 0, taskIds: [] };
    for (const line of lines) {
        const state = useTaskStore.getState();
        try {
            const parseOptions = buildQuickAddParseOptions(state.settings, { tasks: state.tasks, people: state.people });
            const parsed = parseQuickAdd(line, state.projects, new Date(), state.areas, parseOptions);
            const transaction = await executeCaptureTransaction(
                {
                    parsed,
                    rawInput: line,
                    projects: state.projects,
                    initialProps: { status: 'inbox' },
                    selectedAreaId: resolveCaptureAreaId(state.settings, state.areas),
                },
                { addProject: state.addProject, addTask: state.addTask },
                { transformProps: (props) => ({ ...props, status: 'inbox' }) },
            );
            if (transaction.success) {
                result.saved += 1;
                if (transaction.createdTaskId) result.taskIds.push(transaction.createdTaskId);
                continue;
            }
            // Syntax the parser rejected (e.g. a bad /due: command): keep the raw line rather than lose it.
            const fallback = await state.addTask(line, { status: 'inbox' });
            if (fallback?.success) {
                result.saved += 1;
                if (fallback.id) result.taskIds.push(fallback.id);
            } else result.failed += 1;
        } catch {
            result.failed += 1;
        }
    }
    // Flash and scroll to the newest capture, like the old inline quick add (#916).
    const lastId = result.taskIds[result.taskIds.length - 1];
    if (lastId) useTaskStore.getState().setHighlightTask?.(lastId);
    return result;
}
