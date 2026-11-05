import { resolveAnthropicModel } from '../catalog';
import { ANTHROPIC_BASE_URL, buildAnthropicError, isAdaptiveThinkingModel } from '../providers/anthropic';
import type { AIProviderConfig } from '../types';
import { AIRequestStopError, fetchTextWithTimeout, isAIRequestStopError, waitForAIRequestRetry } from '../utils';
import { handleRateLimitedResponse } from '../provider-rate-limit';
import { ASSISTANT_MAX_OUTPUT_TOKENS, ASSISTANT_THINKING_ALLOWANCE_TOKENS } from './guardrails';
import type {
    AssistantMessage,
    AssistantModelClient,
    AssistantModelRequest,
    AssistantModelResponse,
    AssistantToolCall,
    JsonSchema,
} from './types';

const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 2;
const RETRYABLE = new Set([408, 500, 502, 503, 504, 529]);

/**
 * Output cap for one Assistant call. Thinking tokens count against max_tokens, and current Claude
 * models think by default, so they get a bounded thinking allowance on top of the reply cap.
 * Older models without thinking get just the reply cap. Keeps a misused turn cheap.
 */
export function anthropicAssistantTokenLimits(model: string, thinkingBudget: number): { maxTokens: number; thinking?: Record<string, unknown> } {
    const adaptive = isAdaptiveThinkingModel(model);
    if (thinkingBudget > 0 && !adaptive) {
        const budget = Math.max(1024, Math.min(thinkingBudget, ASSISTANT_THINKING_ALLOWANCE_TOKENS));
        return { maxTokens: budget + ASSISTANT_MAX_OUTPUT_TOKENS, thinking: { type: 'enabled', budget_tokens: budget } };
    }
    if (adaptive) {
        return {
            maxTokens: ASSISTANT_MAX_OUTPUT_TOKENS + ASSISTANT_THINKING_ALLOWANCE_TOKENS,
            ...(thinkingBudget > 0 ? { thinking: { type: 'adaptive' } } : {}),
        };
    }
    return { maxTokens: ASSISTANT_MAX_OUTPUT_TOKENS };
}

type AnthropicBlock = { type?: string; [key: string]: unknown };
type AnthropicWireMessage = { role: 'user' | 'assistant'; content: string | AnthropicBlock[] };

/**
 * Anthropic's input_schema is JSON Schema; the harness uses an OpenAPI-style `nullable` flag,
 * so convert it to a `type: [T, "null"]` union and drop the non-standard key.
 */
export function toAnthropicSchema(schema: JsonSchema): Record<string, unknown> {
    const { nullable, properties, items, ...rest } = schema;
    const out: Record<string, unknown> = { ...rest };
    if (nullable && typeof schema.type === 'string') out.type = [schema.type, 'null'];
    if (properties) {
        out.properties = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, toAnthropicSchema(v)]));
    }
    if (items) out.items = toAnthropicSchema(items);
    return out;
}

const parseToolInput = (raw: string): Record<string, unknown> => {
    try {
        const value = JSON.parse(raw);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
};

const looksLikeToolError = (content: string | null): boolean => {
    if (!content) return false;
    try {
        const value = JSON.parse(content);
        return Boolean(value && typeof value === 'object' && 'error' in value && (value as { ok?: unknown }).ok !== true);
    } catch {
        return false;
    }
};

/**
 * Translate the harness's OpenAI-style transcript into Anthropic Messages format:
 * system messages become the top-level `system`; consecutive tool results are grouped into a
 * single user message of tool_result blocks; assistant turns from this turn replay their raw blocks.
 */
export function toAnthropicRequestParts(messages: AssistantMessage[]): { system: string; messages: AnthropicWireMessage[] } {
    const systemParts: string[] = [];
    const out: AnthropicWireMessage[] = [];
    let pendingResults: AnthropicBlock[] = [];

    const flushResults = () => {
        if (pendingResults.length) {
            out.push({ role: 'user', content: pendingResults });
            pendingResults = [];
        }
    };

    for (const m of messages) {
        if (m.role === 'system') {
            if (m.content) systemParts.push(m.content);
            continue;
        }
        if (m.role === 'tool') {
            pendingResults.push({
                type: 'tool_result',
                tool_use_id: m.toolCallId ?? '',
                content: m.content ?? '',
                ...(looksLikeToolError(m.content) ? { is_error: true } : {}),
            });
            continue;
        }
        flushResults();
        if (m.role === 'user') {
            const text = (m.content ?? '').trim();
            if (text) out.push({ role: 'user', content: text });
            continue;
        }
        // assistant
        if (Array.isArray(m.providerBlocks) && m.providerBlocks.length) {
            out.push({ role: 'assistant', content: m.providerBlocks as AnthropicBlock[] });
            continue;
        }
        const blocks: AnthropicBlock[] = [];
        const text = (m.content ?? '').trim();
        if (text) blocks.push({ type: 'text', text });
        for (const call of m.toolCalls ?? []) {
            blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: parseToolInput(call.arguments) });
        }
        if (blocks.length) out.push({ role: 'assistant', content: blocks });
    }
    flushResults();

    // The conversation must open with a user turn; drop any leading assistant history.
    while (out.length && out[0].role !== 'user') out.shift();
    return { system: systemParts.join('\n\n'), messages: out };
}

export function parseAnthropicMessage(bodyText: string): AssistantModelResponse {
    let data: { content?: AnthropicBlock[]; stop_reason?: string; stop_details?: { explanation?: string } | null };
    try {
        data = JSON.parse(bodyText);
    } catch {
        throw new Error('Claude returned invalid JSON.');
    }
    const content = Array.isArray(data?.content) ? data.content : [];
    const stopReason = data?.stop_reason;

    if (stopReason === 'refusal') {
        const why = data.stop_details?.explanation;
        return {
            finishReason: stopReason,
            message: { role: 'assistant', content: why ? `I can't help with that request. ${why}` : "I can't help with that request." },
        };
    }

    const text = content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => String(b.text))
        .join('\n')
        .trim();

    // A reply cut off by max_tokens may carry an incomplete tool call; never execute it.
    if (stopReason === 'max_tokens') {
        return {
            finishReason: stopReason,
            message: { role: 'assistant', content: text || 'My reply was too long and got cut off. Try asking for less at once.' },
        };
    }

    const toolCalls: AssistantToolCall[] = content
        .filter((b) => b.type === 'tool_use' && typeof b.name === 'string')
        .map((b, i) => ({
            id: String(b.id ?? `toolu_${i}`),
            name: String(b.name),
            arguments: JSON.stringify(b.input ?? {}),
        }));

    return {
        finishReason: stopReason,
        message: {
            role: 'assistant',
            content: text || null,
            ...(toolCalls.length ? { toolCalls } : {}),
            providerBlocks: content,
        },
    };
}

/** Tool-calling chat over the Anthropic Messages API (raw fetch, like the existing Anthropic provider). */
export function createAnthropicChatClient(config: AIProviderConfig): AssistantModelClient {
    const apiKey = String(config.apiKey || '').trim();
    if (!apiKey) throw new Error('Anthropic API key is required.');
    const url = config.endpoint || ANTHROPIC_BASE_URL;
    const official = url === ANTHROPIC_BASE_URL;
    const model = official ? resolveAnthropicModel(config.model) : config.model;
    const thinkingBudget = typeof config.thinkingBudget === 'number' ? config.thinkingBudget : 0;

    // Current Claude models think adaptively by default, so `thinking` is only sent when the user
    // turned thinking on. Older models that predate adaptive thinking take a token budget instead.
    // No sampling parameters: current models reject non-default temperature.
    const { maxTokens, thinking } = anthropicAssistantTokenLimits(model, thinkingBudget);

    return {
        async complete(request: AssistantModelRequest): Promise<AssistantModelResponse> {
            const { system, messages } = toAnthropicRequestParts(request.messages);
            const body: Record<string, unknown> = {
                model,
                max_tokens: maxTokens,
                ...(system ? { system } : {}),
                messages,
                tools: request.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    input_schema: toAnthropicSchema(t.parameters),
                })),
                tool_choice: { type: 'auto' },
                ...(thinking ? { thinking } : {}),
            };
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                // Required for direct calls from the desktop webview.
                'anthropic-dangerous-direct-browser-access': 'true',
            };

            let rateLimitRetried = false;
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
                let response;
                try {
                    response = await fetchTextWithTimeout(
                        url,
                        { method: 'POST', headers, body: JSON.stringify(body) },
                        config.timeoutMs && config.timeoutMs > 0 ? Math.max(config.timeoutMs, DEFAULT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
                        'Assistant',
                        request.signal,
                        config.fetcher,
                    );
                } catch (error) {
                    if (isAIRequestStopError(error)) throw error;
                    if (attempt < MAX_RETRIES) {
                        await waitForAIRequestRetry(400 * 2 ** attempt, request.signal, 'Assistant');
                        continue;
                    }
                    throw error;
                }
                if (response.status === 429) {
                    await handleRateLimitedResponse(response, { canRetry: !rateLimitRetried && attempt < MAX_RETRIES, signal: request.signal, label: 'Assistant' });
                    rateLimitRetried = true;
                    continue;
                }
                if (!response.ok && RETRYABLE.has(response.status) && attempt < MAX_RETRIES) {
                    await waitForAIRequestRetry(400 * 2 ** attempt, request.signal, 'Assistant');
                    continue;
                }
                if (!response.ok) throw await buildAnthropicError(response, official);
                return parseAnthropicMessage(response.bodyText);
            }
            throw new AIRequestStopError('aborted', 'Assistant request failed to start.');
        },
    };
}
