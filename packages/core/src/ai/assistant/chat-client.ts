import { isDeepSeekUrl } from '../catalog';
import type { AIProviderConfig } from '../types';
import { AIRequestStopError, fetchTextWithTimeout, isAIRequestStopError, waitForAIRequestRetry } from '../utils';
import { handleRateLimitedResponse } from '../provider-rate-limit';
import { createAnthropicChatClient } from './anthropic-chat-client';
import { ASSISTANT_MAX_OUTPUT_TOKENS, ASSISTANT_THINKING_ALLOWANCE_TOKENS } from './guardrails';
import type { AssistantMessage, AssistantModelClient, AssistantModelRequest, AssistantModelResponse, AssistantToolCall } from './types';

// TODO(integrate): duplicates OPENAI_BASE_URL (private const in ai/providers/openai.ts).
const OPENAI_BASE_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const RETRYABLE = new Set([408, 500, 502, 503, 504]);

// TODO(integrate): duplicates isReasoningModel (private in ai/providers/openai.ts).
const isReasoningModel = (model: string): boolean => {
    const id = model.trim().toLowerCase();
    return id.startsWith('gpt-5') || /^o\d+(?:-|$)/.test(id);
};

const OUTPUT_LIMIT_KEYS = ['max_tokens', 'max_completion_tokens', 'max_output_tokens'];

/**
 * Output cap for one Assistant call on the OpenAI-compatible path. Reasoning/thinking models spend
 * hidden tokens against the cap, so they get a bounded allowance on top of the reply cap. Official
 * OpenAI takes `max_completion_tokens`; other compatible endpoints (DeepSeek, Ollama, LM Studio)
 * take `max_tokens`. An explicit limit in the user's extra request parameters wins.
 */
export function openAIAssistantTokenLimit(params: { model: string; official: boolean; extra: Record<string, unknown> }): Record<string, number> {
    if (OUTPUT_LIMIT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(params.extra, key))) return {};
    const thinkingExtra = params.extra.thinking as { type?: unknown } | undefined;
    const thinkingDisabled = Boolean(thinkingExtra) && typeof thinkingExtra === 'object' && thinkingExtra.type === 'disabled';
    // Newer DeepSeek models (v4 and later) think by default; `deepseek-chat` is the non-thinking alias.
    const deepseekThinks = /deepseek/i.test(params.model) && !/deepseek-chat$/i.test(params.model.trim());
    const thinks = !thinkingDisabled && (
        isReasoningModel(params.model)
        || deepseekThinks
        || /reason|think|(?:^|[-_/])r1(?:$|[-_])/i.test(params.model)
        || (Boolean(thinkingExtra) && typeof thinkingExtra === 'object'));
    const limit = thinks ? ASSISTANT_MAX_OUTPUT_TOKENS + ASSISTANT_THINKING_ALLOWANCE_TOKENS : ASSISTANT_MAX_OUTPUT_TOKENS;
    return params.official ? { max_completion_tokens: limit } : { max_tokens: limit };
}

export const isAssistantProviderSupported = (config: Pick<AIProviderConfig, 'provider'>): boolean =>
    config.provider === 'openai' || config.provider === 'anthropic';

/** Picks the tool-calling client for the configured provider. Gemini is not wired yet. */
export function createAssistantChatClient(config: AIProviderConfig): AssistantModelClient {
    if (config.provider === 'anthropic') return createAnthropicChatClient(config);
    return createOpenAICompatibleChatClient(config);
}

export function toWireMessage(m: AssistantMessage): Record<string, unknown> {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content ?? '' };
    if (m.role === 'assistant') {
        return {
            role: 'assistant',
            content: m.content ?? (m.toolCalls?.length ? null : ''),
            ...(m.reasoningContent ? { reasoning_content: m.reasoningContent } : {}),
            ...(m.toolCalls?.length
                ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) }
                : {}),
        };
    }
    return { role: m.role, content: m.content ?? '' };
}

export function parseChatCompletion(bodyText: string): AssistantModelResponse {
    let data: any;
    try { data = JSON.parse(bodyText); } catch { throw new Error('AI endpoint returned invalid JSON.'); }
    const choice = data?.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error('AI endpoint returned no message.');
    // A reply cut off by the output cap may carry an incomplete tool call; never execute it.
    if (choice.finish_reason === 'length') {
        const text = typeof msg.content === 'string' ? msg.content.trim() : '';
        return {
            finishReason: choice.finish_reason,
            message: { role: 'assistant', content: text || 'My reply was too long and got cut off. Try asking for less at once.' },
        };
    }
    const toolCalls: AssistantToolCall[] = Array.isArray(msg.tool_calls)
        ? msg.tool_calls
            .filter((c: any) => c?.function?.name)
            .map((c: any, i: number) => ({
                id: String(c.id ?? `call_${i}`),
                name: String(c.function.name),
                arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}),
            }))
        : [];
    return {
        finishReason: choice.finish_reason,
        message: {
            role: 'assistant',
            content: typeof msg.content === 'string' ? msg.content : null,
            ...(toolCalls.length ? { toolCalls } : {}),
            ...(typeof msg.reasoning_content === 'string' && msg.reasoning_content ? { reasoningContent: msg.reasoning_content } : {}),
        },
    };
}

/** Chat-completions-with-tools over the OpenAI-compatible path (OpenAI, DeepSeek, custom base URLs). */
export function createOpenAICompatibleChatClient(config: AIProviderConfig): AssistantModelClient {
    if (config.provider !== 'openai') {
        throw new Error('This client is for OpenAI-compatible providers (OpenAI, DeepSeek, custom base URLs).');
    }
    const url = config.endpoint || OPENAI_BASE_URL;
    const official = url === OPENAI_BASE_URL;
    const apiKey = String(config.apiKey || '').trim();
    if (!apiKey && official) throw new Error('OpenAI API key is required.');
    const extra = config.extraBodyParams ?? {};
    const reasoning = isReasoningModel(config.model) && !isDeepSeekUrl(url);

    return {
        async complete(request: AssistantModelRequest): Promise<AssistantModelResponse> {
            const body = {
                ...extra,
                model: config.model,
                messages: request.messages.map(toWireMessage),
                tools: request.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
                tool_choice: 'auto',
                ...(Object.prototype.hasOwnProperty.call(extra, 'temperature') || reasoning ? {} : { temperature: 0.2 }),
                ...(reasoning && config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
                ...openAIAssistantTokenLimit({ model: config.model, official, extra }),
            };
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
            let rateLimitRetried = false;
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
                let response;
                try {
                    response = await fetchTextWithTimeout(
                        url, { method: 'POST', headers, body: JSON.stringify(body) },
                        config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS,
                        'Assistant', request.signal, config.fetcher,
                    );
                } catch (error) {
                    if (isAIRequestStopError(error)) throw error;
                    if (attempt < MAX_RETRIES) { await waitForAIRequestRetry(400 * 2 ** attempt, request.signal, 'Assistant'); continue; }
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
                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) throw new Error('The AI endpoint rejected the request. Check the API key and model in AI settings.');
                    let detail = '';
                    try { detail = JSON.parse(response.bodyText)?.error?.message ?? ''; } catch { /* ignore */ }
                    throw new Error(`AI request failed (${response.status})${detail ? `: ${String(detail).slice(0, 200)}` : ''}`);
                }
                return parseChatCompletion(response.bodyText);
            }
            throw new AIRequestStopError('aborted', 'Assistant request failed to start.');
        },
    };
}
