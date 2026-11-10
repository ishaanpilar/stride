import { parseToolArguments, validateAgainstSchema } from './schema';
import type { AssistantTool, ChangeEntry, ToolContext, ToolOutcome, UndoOp } from './types';

export const MAX_PLAN_STEPS = 30;

interface PlanStep { tool: string; args: Record<string, any> }

const brief = (value: unknown): string => {
    const text = JSON.stringify(value) ?? '';
    return text.length > 90 ? `${text.slice(0, 87)}...` : text;
};
const describeStep = (s: PlanStep) => `${s.tool.replace(/_/g, ' ')} ${brief(s.args)}`;

/** Validate every step against its tool (schema + semantic). Invalid steps are dropped and reported. */
function checkSteps(raw: any[], tools: AssistantTool[], ctx: ToolContext) {
    const valid: Array<{ step: PlanStep; tool: AssistantTool; args: Record<string, any> }> = [];
    const skipped: string[] = [];
    for (const [i, entry] of raw.entries()) {
        const tool = tools.find((t) => t.name === entry?.tool && t.mutating && !t.prepare);
        if (!tool) { skipped.push(`step ${i + 1}: "${entry?.tool}" is not an allowed action`); continue; }
        const parsed = typeof entry.args === 'string' ? parseToolArguments(entry.args) : { ok: true as const, value: entry.args ?? {} };
        if (!parsed.ok) { skipped.push(`step ${i + 1} (${tool.name}): ${parsed.error}`); continue; }
        const checked = validateAgainstSchema(tool.parameters, parsed.value);
        if (!checked.ok) { skipped.push(`step ${i + 1} (${tool.name}): ${checked.error}`); continue; }
        let semantic: string | null = null;
        try { semantic = tool.validate?.(checked.value, ctx) ?? null; } catch (e) { semantic = e instanceof Error ? e.message : String(e); }
        if (semantic) { skipped.push(`step ${i + 1} (${tool.name}): ${semantic}`); continue; }
        valid.push({ step: { tool: tool.name, args: checked.value }, tool, args: checked.value });
    }
    return { valid, skipped };
}

/**
 * One approval, one undo group: applies several mutating tools in order and records them as a
 * single ChangeEntry. Built from the full tool list so steps can use any mutating tool.
 */
export function createPlanTool(getTools: () => AssistantTool[]): AssistantTool {
    return {
        name: 'apply_plan',
        description: 'Cleanup / batch mode: apply SEVERAL changes after ONE user approval and ONE undo. First gather candidates with read tools (get_overview, list_projects, find_duplicates), describe the plan to the user in your reply (e.g. "rename 2, archive 3, merge 1") and then call this; the user sees a single Confirm card. Each step is {tool, args} for any mutating tool (update_project, archive_project, merge_projects, merge_tasks, bulk_update_tasks, rename_tag, ...). Use real ids. Steps are validated against the current state; invalid ones are skipped.',
        mutating: true,
        parameters: {
            type: 'object',
            required: ['summary', 'steps'],
            properties: {
                summary: { type: 'string', minLength: 1, maxLength: 200, description: 'One line, e.g. "Rename 2 projects, archive 3, merge 1".' },
                steps: {
                    type: 'array', minItems: 1, maxItems: MAX_PLAN_STEPS,
                    items: { type: 'object', required: ['tool', 'args'], properties: { tool: { type: 'string', minLength: 1 }, args: { type: 'object', additionalProperties: true } } },
                },
            },
        },
        validate: (a, ctx) => {
            const { valid, skipped } = checkSteps(a.steps, getTools(), ctx);
            return valid.length ? null : `No valid steps. ${skipped.join('; ')}`;
        },
        confirmation: (a, ctx) => {
            const { valid, skipped } = checkSteps(a.steps, getTools(), ctx);
            const ids = new Set<string>();
            for (const { args } of valid) {
                for (const key of ['id', 'keepId', 'removeId']) if (typeof args[key] === 'string') ids.add(args[key]);
                if (Array.isArray(args.ids)) for (const id of args.ids) ids.add(String(id));
            }
            const tasks = ctx.port.getSnapshot().tasks;
            const affected = [...ids].map((id) => tasks.find((t) => t.id === id || (id.length >= 4 && t.id.startsWith(id)))?.id).filter((x): x is string => !!x);
            const lines = valid.map((v, i) => `${i + 1}. ${describeStep(v.step)}`);
            if (skipped.length) lines.push(`(${skipped.length} invalid step${skipped.length === 1 ? '' : 's'} will be skipped)`);
            return { reason: `Batch plan with ${valid.length} step${valid.length === 1 ? '' : 's'}`, summary: `${a.summary}\n${lines.join('\n')}`, affectedTaskIds: affected.slice(0, 50) };
        },
        execute: async (a, ctx): Promise<ToolOutcome> => {
            const tools = getTools();
            const undoOps: UndoOp[] = [];
            const changes: ChangeEntry['changes'] = [];
            const details: string[] = [];
            const failed: string[] = [];
            let done = 0;
            for (const [i, entry] of (a.steps as any[]).entries()) {
                // Re-validate each step against the state produced by the previous ones.
                const { valid, skipped } = checkSteps([entry], tools, ctx);
                if (!valid.length) { failed.push(`step ${i + 1}: ${skipped[0]?.replace(/^step 1[^:]*: /, '') ?? 'invalid'}`); continue; }
                try {
                    const outcome = await valid[0].tool.execute(valid[0].args, ctx);
                    if (!outcome.ok) { failed.push(`step ${i + 1} (${valid[0].tool.name}): ${outcome.error}`); continue; }
                    done += 1;
                    if (outcome.change) { undoOps.unshift(...[...outcome.change.undoOps].reverse()); changes.push(...outcome.change.changes); details.push(outcome.change.label); }
                } catch (e) {
                    failed.push(`step ${i + 1} (${valid[0].tool.name}): ${e instanceof Error ? e.message : String(e)}`);
                }
            }
            if (done === 0) return { ok: false, error: `No step could be applied. ${failed.join('; ')}` };
            return {
                ok: true,
                data: { applied: done, failed },
                change: { kind: 'plan', label: `${a.summary} · ${done} of ${a.steps.length} steps`, details, undoOps, changes },
            };
        },
    };
}
