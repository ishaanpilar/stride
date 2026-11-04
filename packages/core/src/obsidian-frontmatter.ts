const FRONTMATTER_BOUNDARY_RE = /^---\s*$/;

export type ObsidianYamlScalar = string | boolean | number;
export type ObsidianYamlValue = ObsidianYamlScalar | ObsidianYamlScalar[];
export type ObsidianFrontmatterProperties = Record<string, ObsidianYamlValue>;

export type SplitObsidianFrontmatterResult = {
    properties: ObsidianFrontmatterProperties;
    body: string;
    bodyLines: string[];
    bodyStartLineNumber: number;
};

export const stripObsidianYamlQuotes = (value: string): string => {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
};

const parseInlineArray = (input: string): ObsidianYamlScalar[] => {
    return input
        .split(',')
        .map((item) => parseObsidianYamlScalar(item))
        .filter((item) => !(typeof item === 'string' && !item.trim()));
};

export const parseObsidianYamlScalar = (value: string): ObsidianYamlScalar => {
    const trimmed = value.trim();
    if (!trimmed) return '';

    if (/^(true|false)$/i.test(trimmed)) {
        return trimmed.toLowerCase() === 'true';
    }

    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return stripObsidianYamlQuotes(trimmed);
};

export const parseObsidianYamlValue = (value: string): ObsidianYamlValue => {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return parseInlineArray(trimmed.slice(1, -1));
    }
    return parseObsidianYamlScalar(trimmed);
};

export const parseObsidianFrontmatterProperties = (input: string): ObsidianFrontmatterProperties => {
    const properties: ObsidianFrontmatterProperties = {};
    let currentArrayKey: string | null = null;

    for (const rawLine of input.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (!line.trim() || line.trimStart().startsWith('#')) {
            continue;
        }

        const listItemMatch = line.match(/^\s*-\s*(.+)$/);
        if (listItemMatch && currentArrayKey) {
            const current = properties[currentArrayKey];
            const item = parseObsidianYamlScalar(listItemMatch[1] || '');
            if (typeof item === 'string' && !item.trim()) {
                continue;
            }
            if (Array.isArray(current)) {
                current.push(item);
            } else if (typeof current === 'string' || typeof current === 'boolean' || typeof current === 'number') {
                properties[currentArrayKey] = [current, item];
            } else {
                properties[currentArrayKey] = [item];
            }
            continue;
        }

        const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!match) {
            currentArrayKey = null;
            continue;
        }

        const key = match[1];
        const rawValue = match[2] ?? '';
        if (!rawValue.trim()) {
            properties[key] = [];
            currentArrayKey = key;
            continue;
        }

        const parsed = parseObsidianYamlValue(rawValue);
        properties[key] = parsed;
        currentArrayKey = Array.isArray(parsed) ? key : null;
    }

    return properties;
};

export const splitObsidianFrontmatter = (markdown: string): SplitObsidianFrontmatterResult => {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    if (!FRONTMATTER_BOUNDARY_RE.test(lines[0] || '')) {
        return {
            properties: {},
            body: lines.join('\n'),
            bodyLines: lines,
            bodyStartLineNumber: 1,
        };
    }

    for (let index = 1; index < lines.length; index += 1) {
        if (!FRONTMATTER_BOUNDARY_RE.test(lines[index] || '')) continue;
        const bodyLines = lines.slice(index + 1);
        return {
            properties: parseObsidianFrontmatterProperties(lines.slice(1, index).join('\n')),
            body: bodyLines.join('\n'),
            bodyLines,
            bodyStartLineNumber: index + 2,
        };
    }

    return {
        properties: {},
        body: lines.join('\n'),
        bodyLines: lines,
        bodyStartLineNumber: 1,
    };
};
