import type { JsonSchema } from './types';

export type SchemaResult = { ok: true; value: any } | { ok: false; error: string };

/**
 * Minimal JSON-schema validator with light repair: numeric/boolean strings are coerced,
 * a lone string becomes a one-item array, empty strings for optional fields are dropped.
 * Unknown properties are rejected (the model should not invent arguments).
 */
export function validateAgainstSchema(schema: JsonSchema, input: unknown, path = 'arguments'): SchemaResult {
    if (input === null || input === undefined) {
        if (schema.nullable) return { ok: true, value: null };
        return { ok: false, error: `${path} must not be null` };
    }
    switch (schema.type) {
        case 'object': {
            if (typeof input === 'string' && schema.properties?.title && input.trim()) input = { title: input };
            if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: `${path} must be an object` };
            const src = input as Record<string, unknown>;
            const props = schema.properties ?? {};
            const out: Record<string, unknown> = {};
            if (schema.additionalProperties === true && !schema.properties) return { ok: true, value: { ...src } };
            for (const key of Object.keys(src)) {
                if (!(key in props)) {
                    return { ok: false, error: `${path}.${key} is not a known argument. Allowed: ${Object.keys(props).join(', ')}` };
                }
            }
            for (const key of schema.required ?? []) {
                if (src[key] === undefined || src[key] === null || src[key] === '') {
                    return { ok: false, error: `${path}.${key} is required` };
                }
            }
            for (const [key, sub] of Object.entries(props)) {
                const v = src[key];
                if (v === undefined) continue;
                if (v === '' && !(schema.required ?? []).includes(key) && sub.type !== 'string') continue;
                const r = validateAgainstSchema(sub, v, `${path}.${key}`);
                if (!r.ok) return r;
                out[key] = r.value;
            }
            return { ok: true, value: out };
        }
        case 'string': {
            if (typeof input !== 'string') {
                if (typeof input === 'number') input = String(input);
                else return { ok: false, error: `${path} must be a string` };
            }
            const s = (input as string).trim();
            if (schema.minLength !== undefined && s.length < schema.minLength) return { ok: false, error: `${path} must be at least ${schema.minLength} characters` };
            if (schema.maxLength !== undefined && s.length > schema.maxLength) return { ok: false, error: `${path} must be at most ${schema.maxLength} characters` };
            if (schema.enum && !schema.enum.includes(s)) return { ok: false, error: `${path} must be one of: ${schema.enum.join(', ')}` };
            return { ok: true, value: s };
        }
        case 'integer':
        case 'number': {
            let n: unknown = input;
            if (typeof n === 'string' && n.trim() !== '' && Number.isFinite(Number(n))) n = Number(n);
            if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, error: `${path} must be a number` };
            if (schema.type === 'integer' && !Number.isInteger(n)) return { ok: false, error: `${path} must be an integer` };
            if (schema.minimum !== undefined && n < schema.minimum) return { ok: false, error: `${path} must be >= ${schema.minimum}` };
            if (schema.maximum !== undefined && n > schema.maximum) return { ok: false, error: `${path} must be <= ${schema.maximum}` };
            return { ok: true, value: n };
        }
        case 'boolean': {
            if (typeof input === 'boolean') return { ok: true, value: input };
            if (input === 'true') return { ok: true, value: true };
            if (input === 'false') return { ok: true, value: false };
            return { ok: false, error: `${path} must be a boolean` };
        }
        case 'array': {
            let arr: unknown = input;
            if (!Array.isArray(arr)) {
                if (schema.items?.type === 'string' && typeof arr === 'string') arr = [arr];
                else return { ok: false, error: `${path} must be an array` };
            }
            const list = arr as unknown[];
            if (schema.minItems !== undefined && list.length < schema.minItems) return { ok: false, error: `${path} needs at least ${schema.minItems} item(s)` };
            if (schema.maxItems !== undefined && list.length > schema.maxItems) return { ok: false, error: `${path} allows at most ${schema.maxItems} items` };
            const out: unknown[] = [];
            for (let i = 0; i < list.length; i += 1) {
                const r = validateAgainstSchema(schema.items ?? {}, list[i], `${path}[${i}]`);
                if (!r.ok) return r;
                out.push(r.value);
            }
            return { ok: true, value: out };
        }
        default:
            return { ok: true, value: input };
    }
}

/** Parse the model's raw argument string, repairing common glitches (fences, prose, trailing commas). */
export function parseToolArguments(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
    let text = (raw ?? '').trim();
    if (!text) return { ok: true, value: {} };
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
    if (fence) text = fence[1].trim();
    const attempt = (s: string) => {
        try {
            const v = JSON.parse(s);
            return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
        } catch {
            return null;
        }
    };
    let parsed = attempt(text);
    if (!parsed) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
            const slice = text.slice(start, end + 1);
            parsed = attempt(slice) ?? attempt(slice.replace(/,\s*([}\]])/g, '$1'));
        }
    }
    if (!parsed) return { ok: false, error: 'Tool arguments were not valid JSON. Send one JSON object matching the tool schema.' };
    return { ok: true, value: parsed };
}
