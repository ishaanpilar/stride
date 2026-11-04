


export const STRIDE_CSV_COLUMNS = [
    'Title', 'Description', 'Status', 'Project', 'Section', 'Area', 'Contexts', 'Tags',
    'Assigned To', 'Priority', 'Energy', 'Start Date', 'Due Date', 'Review Date',
    'Completed At', 'Checklist', 'Location', 'Order', 'ID', 'Created At', 'Recurrence',
    'Cancelled At',
] as const;

export type StrideCsvColumn = typeof STRIDE_CSV_COLUMNS[number];

export const STRIDE_CSV_KNOWN_COLUMNS: ReadonlySet<string> = new Set<string>(
    STRIDE_CSV_COLUMNS.map((column) => column.toUpperCase()),
);


// LEGACY: pre-Stride-rename token, kept so existing exported CSVs keep importing.
export const STRIDE_CSV_FLUID_RECURRENCE_TOKEN = 'X-MINDWTR-STRATEGY=FLUID';
