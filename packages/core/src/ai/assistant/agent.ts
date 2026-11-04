import { generateUUID } from '../../uuid';
import { AssistantChangeLog } from './change-log';
import { buildSystemPrompt } from './prompt';
import { parseToolArguments, validateAgainstSchema } from './schema';
import { ASSISTANT_TOOLS, getToolDefinitions } from './tools';
import type {
    AssistantMessage,
    AssistantModelClient,
    AssistantStorePort,
    AssistantTool,
    ChangeEntry,
    PendingConfirmation,
    ToolContext,
    ToolOutcome,
} from './types';

export const DEFAULT_MAX_STEPS = 8;
export const DEFAULT_CALL_TIMEOUT_MS = 60_000;
const MAX_TOOL_CALLS_PER_STEP = 12;
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_RESULT_CHARS = 6000;

export interface HistoryMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface RunTurnOptions {
    client: AssistantModelClient;
    port: AssistantStorePort;
    changeLog: AssistantChangeLog;
    history?: HistoryMessage[];
    userText: string;
    /** Id of the user message; groups changes for "undo all from this message". */
    messageId: string;
    now?: Date;
    timeZone?: string;
    maxSteps?: number;
    callTimeoutMs?: number;
    signal?: AbortSignal;
    tools?: AssistantTool[];
    onToolEvent?: (event: { name: string; status: 'ok' | 'error' | 'pending'; label?: string }) => void;
}

export interface TurnResult {
    reply: string;
    entries: ChangeEntry[];
    pending: PendingConfirmation[];
    status: 'ok' | 'max_steps' | 'error' | 'aborted';
    error?: string;
    steps: number;
}

/** Keep the last N history messages, starting on a user message, within a char budget. */
export function capHistory(history: HistoryMessage[], maxMessages = 20, maxChars = 12_000): HistoryMessage[] {
    let out = history.slice(-maxMessages);
    let total = out.reduce((n, m) => n + m.content.length, 0);
    while (out.length > 1 && total > maxChars) {
        total -= out[0].content.length;
        out = out.slice(1);
    }
    while (out.length && out[0].role !== 'user') out = out.slice(1);
    return out;
}

const json = (value: unknown): string => {
    const text = JSON.stringify(value);
    return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}...(truncated)` : text;
};

interface ExecResult {
    content: string;
    ok: boolean;
    entry?: ChangeEntry;
    pending?: PendingConfirmation;
}

/** Validate -> (gate) -> execute one tool call. Never throws. */
export async function runToolCall(params: {
    name: string;
    rawArguments: string;
    tools: AssistantTool[];
    ctx: ToolContext;
    changeLog: AssistantChangeLog;
    messageId: string;
    skipConfirmation?: boolean;
}): Promise<ExecResult> {
    const { name, rawArguments, tools, ctx, changeLog, messageId } = params;
    const tool = tools.find((t) => t.name === name);
    if (!tool) return { ok: false, content: json({ error: `Unknown tool "${name}". Available: ${tools.map((t) => t.name).join(', ')}` }) };
    const parsed = parseToolArguments(rawArguments);
    if (!parsed.ok) return { ok: false, content: json({ error: parsed.error }) };
    const checked = validateAgainstSchema(tool.parameters, parsed.value);
    if (!checked.ok) return { ok: false, content: json({ error: checked.error }) };
    const args = checked.value as Record<string, any>;
    try {
        const semantic = tool.validate?.(args, ctx);
        if (semantic) return { ok: false, content: json({ error: semantic }) };
        if (!params.skipConfirmation) {
            const gate = tool.confirmation?.(args, ctx);
            if (gate) {
                const snapshot = ctx.port.getSnapshot().tasks;
                const pending: PendingConfirmation = {
                    id: generateUUID(),
                    messageId,
                    toolName: tool.name,
                    args,
                    reason: gate.reason,
                    summary: gate.summary,
                    affected: gate.affectedTaskIds.map((id) => ({ id, title: snapshot.find((t) => t.id === id)?.title ?? id })),
                    status: 'pending',
                    createdAt: new Date().toISOString(),
                };
                return {
                    ok: true,
                    pending,
                    content: json({ status: 'needs_confirmation', message: `Nothing was changed. The user must confirm in the UI: "${gate.summary}". Do not retry; tell the user to confirm or decline.` }),
                };
            }
        }
        const outcome: ToolOutcome = await tool.execute(args, ctx);
        if (!outcome.ok) return { ok: false, content: json({ error: outcome.error ?? 'Tool failed' }) };
        const entry = outcome.change ? changeLog.record(messageId, tool.name, outcome.change) : undefined;
        return { ok: true, entry, content: json(outcome.data ?? { ok: true }) };
    } catch (error) {
        return { ok: false, content: json({ error: `Tool crashed: ${error instanceof Error ? error.message : String(error)}` }) };
    }
}

/** Execute a gated action after the user pressed Confirm (arguments are re-validated against fresh state). */
export async function executeConfirmed(
    pending: PendingConfirmation,
    deps: { port: AssistantStorePort; changeLog: AssistantChangeLog; now?: Date; timeZone?: string; tools?: AssistantTool[] },
): Promise<{ ok: boolean; entry?: ChangeEntry; error?: string }> {
    const result = await runToolCall({
        name: pending.toolName,
        rawArguments: JSON.stringify(pending.args),
        tools: deps.tools ?? ASSISTANT_TOOLS,
        ctx: { port: deps.port, now: deps.now ?? new Date(), timeZone: deps.timeZone },
        changeLog: deps.changeLog,
        messageId: pending.messageId,
        skipConfirmation: true,
    });
    if (!result.ok) {
        let error = 'Action failed';
        try { error = JSON.parse(result.content).error ?? error; } catch { /* keep default */ }
        return { ok: false, error };
    }
    return { ok: true, entry: result.entry };
}

async function completeWithTimeout(options: RunTurnOptions, messages: AssistantMessage[], tools: AssistantTool[]) {
    const controller = new AbortController();
    const timeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
        return await Promise.race([
            options.client.complete({ messages, tools: getToolDefinitions(tools), signal: controller.signal }),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(new Error('The AI request timed out.')); }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
    }
}

export async function runAssistantTurn(options: RunTurnOptions): Promise<TurnResult> {
    const tools = options.tools ?? ASSISTANT_TOOLS;
    const now = options.now ?? new Date();
    const ctx: ToolContext = { port: options.port, now, timeZone: options.timeZone };
    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    const messages: AssistantMessage[] = [
        { role: 'system', content: buildSystemPrompt(options.port, now, options.timeZone) },
        ...capHistory(options.history ?? []).map((m) => ({ role: m.role, content: m.content }) as AssistantMessage),
        { role: 'user', content: options.userText },
    ];
    const entries: ChangeEntry[] = [];
    const pending: PendingConfirmation[] = [];
    let failures = 0;

    const summarize = (prefix: string) => {
        const parts = entries.map((e) => e.label);
        if (pending.length) parts.push(...pending.map((p) => `Needs your confirmation: ${p.summary}`));
        return parts.length ? `${prefix}${parts.join('. ')}.` : prefix.trim();
    };

    for (let step = 1; step <= maxSteps; step += 1) {
        if (options.signal?.aborted) return { reply: summarize(''), entries, pending, status: 'aborted', steps: step - 1 };
        let response;
        try {
            response = await completeWithTimeout(options, messages, tools);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { reply: summarize('Something went wrong. '), entries, pending, status: options.signal?.aborted ? 'aborted' : 'error', error: message, steps: step };
        }
        const assistant = response.message;
        messages.push(assistant);
        const calls = assistant.toolCalls ?? [];
        if (calls.length === 0) {
            const text = (assistant.content ?? '').trim();
            return { reply: text || summarize('Done. ') || 'Done.', entries, pending, status: 'ok', steps: step };
        }
        for (const call of calls.slice(0, MAX_TOOL_CALLS_PER_STEP)) {
            const result = await runToolCall({
                name: call.name, rawArguments: call.arguments, tools, ctx, changeLog: options.changeLog, messageId: options.messageId,
            });
            if (result.entry) entries.push(result.entry);
            if (result.pending) pending.push(result.pending);
            failures = result.ok ? 0 : failures + 1;
            options.onToolEvent?.({ name: call.name, status: result.pending ? 'pending' : result.ok ? 'ok' : 'error', label: result.entry?.label });
            messages.push({ role: 'tool', toolCallId: call.id, content: result.content });
        }
        // Every tool_call id must be answered, even ones beyond the per-step cap.
        for (const call of calls.slice(MAX_TOOL_CALLS_PER_STEP)) {
            messages.push({ role: 'tool', toolCallId: call.id, content: json({ error: 'Too many tool calls in one step; call fewer tools.' }) });
        }
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
            return { reply: summarize('I could not complete that request. '), entries, pending, status: 'error', error: 'Too many failed tool calls', steps: step };
        }
    }
    return { reply: summarize('I stopped after reaching the step limit. '), entries, pending, status: 'max_steps', steps: maxSteps };
}
