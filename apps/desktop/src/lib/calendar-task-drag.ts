export const CALENDAR_TASK_DRAG_MIME = 'application/x-stride-task-id';
export const CALENDAR_TASK_DRAG_KIND_MIME = 'application/x-stride-calendar-item-kind';

const CALENDAR_TASK_DRAG_TEXT_PREFIX = 'stride-task:';
const CALENDAR_TASK_DRAG_PREVIEW_CLASS = 'stride-calendar-drag-preview';

type CalendarTaskDragDataTransfer = Pick<DataTransfer, 'getData' | 'setData'> & {
    dropEffect?: DataTransfer['dropEffect'];
    effectAllowed?: DataTransfer['effectAllowed'];
    setDragImage?: DataTransfer['setDragImage'];
    types?: readonly string[];
};

type CalendarTaskDragOptions = {
    itemKind?: 'scheduled' | 'deadline';
    variant?: 'calendar-block' | 'compact';
    row?: { element: HTMLElement; clientX: number; clientY: number };
};

const ROW_PREVIEW_MAX_WIDTH = 640;

function buildRowPreview(element: HTMLElement): HTMLElement {
    const rect = element.getBoundingClientRect();
    const preview = element.cloneNode(true) as HTMLElement;
    [preview, ...Array.from(preview.querySelectorAll<HTMLElement>('[id], [data-task-id], [data-reorder-row]'))].forEach((node) => {
        node.removeAttribute('id');
        node.removeAttribute('data-task-id');
        node.removeAttribute('data-reorder-row');
    });
    preview.setAttribute('aria-hidden', 'true');
    preview.style.width = `${Math.min(ROW_PREVIEW_MAX_WIDTH, Math.max(1, rect.width))}px`;
    preview.style.boxShadow = '0 14px 32px rgba(15, 23, 42, 0.20), 0 3px 8px rgba(15, 23, 42, 0.10)';
    preview.style.borderRadius = '14px';
    preview.style.background = 'hsl(var(--card))';
    preview.style.opacity = '0.96';
    return preview;
}

const normalizeTaskId = (value: string): string | null => {
    const taskId = value.trim();
    return taskId.length > 0 ? taskId : null;
};

export const setCalendarTaskDragData = (
    dataTransfer: CalendarTaskDragDataTransfer,
    taskId: string,
    options: CalendarTaskDragOptions = {},
): void => {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!normalizedTaskId) return;

    dataTransfer.effectAllowed = 'move';
    dataTransfer.setData(CALENDAR_TASK_DRAG_MIME, normalizedTaskId);
    if (options.itemKind) {
        dataTransfer.setData(CALENDAR_TASK_DRAG_KIND_MIME, options.itemKind);
    }
    dataTransfer.setData('text/plain', `${CALENDAR_TASK_DRAG_TEXT_PREFIX}${normalizedTaskId}`);

    if (!dataTransfer.setDragImage || typeof document === 'undefined') return;

    document.querySelectorAll(`.${CALENDAR_TASK_DRAG_PREVIEW_CLASS}`).forEach((element) => element.remove());

    if (options.row) {
        const rect = options.row.element.getBoundingClientRect();
        const rowPreview = buildRowPreview(options.row.element);
        rowPreview.classList.add(CALENDAR_TASK_DRAG_PREVIEW_CLASS);
        rowPreview.style.position = 'fixed';
        rowPreview.style.top = '-2000px';
        rowPreview.style.left = '-2000px';
        rowPreview.style.margin = '0';
        rowPreview.style.pointerEvents = 'none';
        rowPreview.style.zIndex = '2147483647';
        document.body.appendChild(rowPreview);
        const width = Math.min(ROW_PREVIEW_MAX_WIDTH, Math.max(1, rect.width));
        const offsetX = Number.isFinite(options.row.clientX) ? Math.min(width, Math.max(0, options.row.clientX - rect.left)) : 16;
        const offsetY = Number.isFinite(options.row.clientY) ? Math.max(0, options.row.clientY - rect.top) : 16;
        dataTransfer.setDragImage(rowPreview, offsetX, offsetY);
        removePreviewWhenDragEnds(rowPreview);
        return;
    }

    const isCalendarBlock = options.variant === 'calendar-block';
    const preview = document.createElement('div');
    preview.className = CALENDAR_TASK_DRAG_PREVIEW_CLASS;
    preview.textContent = '';
    preview.style.position = 'fixed';
    preview.style.top = '-1000px';
    preview.style.left = '-1000px';
    preview.style.boxSizing = 'border-box';
    preview.style.width = isCalendarBlock ? '96px' : '56px';
    preview.style.height = isCalendarBlock ? '28px' : '24px';
    preview.style.margin = '0';
    preview.style.transform = 'none';
    preview.style.border = '1px solid hsl(var(--primary))';
    preview.style.borderRadius = '5px';
    preview.style.background = 'hsl(var(--primary))';
    preview.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.22)';
    preview.style.opacity = '0.92';
    preview.style.pointerEvents = 'none';
    preview.style.zIndex = '2147483647';

    if (isCalendarBlock) {
        const titleLine = document.createElement('div');
        titleLine.style.width = '64px';
        titleLine.style.height = '5px';
        titleLine.style.margin = '6px 0 0 7px';
        titleLine.style.borderRadius = '999px';
        titleLine.style.background = 'rgba(255, 255, 255, 0.75)';
        preview.appendChild(titleLine);

        const timeLine = document.createElement('div');
        timeLine.style.width = '44px';
        timeLine.style.height = '4px';
        timeLine.style.margin = '5px 0 0 7px';
        timeLine.style.borderRadius = '999px';
        timeLine.style.background = 'rgba(255, 255, 255, 0.55)';
        preview.appendChild(timeLine);
    }

    document.body.appendChild(preview);
    dataTransfer.setDragImage(preview, 12, 12);
    removePreviewWhenDragEnds(preview);
};

function removePreviewWhenDragEnds(preview: HTMLElement) {
    const remove = () => {
        preview.remove();
        window.removeEventListener('dragend', remove, true);
        window.removeEventListener('drop', remove, true);
    };
    window.addEventListener('dragend', remove, true);
    window.addEventListener('drop', remove, true);
}

export const getCalendarTaskDragTaskId = (
    dataTransfer: Pick<DataTransfer, 'getData'> | null,
): string | null => {
    if (!dataTransfer) return null;

    const taskId = normalizeTaskId(dataTransfer.getData(CALENDAR_TASK_DRAG_MIME));
    if (taskId) return taskId;

    const textValue = dataTransfer.getData('text/plain').trim();
    if (!textValue.startsWith(CALENDAR_TASK_DRAG_TEXT_PREFIX)) return null;

    return normalizeTaskId(textValue.slice(CALENDAR_TASK_DRAG_TEXT_PREFIX.length));
};

export const getCalendarTaskDragItemKind = (
    dataTransfer: Pick<DataTransfer, 'getData'> | null,
): 'scheduled' | 'deadline' | null => {
    if (!dataTransfer) return null;
    const kind = dataTransfer.getData(CALENDAR_TASK_DRAG_KIND_MIME).trim();
    return kind === 'scheduled' || kind === 'deadline' ? kind : null;
};

export const hasCalendarTaskDragData = (
    dataTransfer: Pick<DataTransfer, 'getData'> & { types?: readonly string[] } | null,
): boolean => {
    if (!dataTransfer) return false;
    if (dataTransfer.types?.includes(CALENDAR_TASK_DRAG_MIME)) return true;
    return getCalendarTaskDragTaskId(dataTransfer) !== null;
};
