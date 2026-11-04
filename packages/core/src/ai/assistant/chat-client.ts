import { isDeepSeekUrl } from '../catalog';
import type { AIProviderConfig } from '../types';
import { AIRequestStopError, fetchTextWithTimeout, isAIRequestStopError, waitForAIRequestRetry } from '../utils';
import { createAnthropicChatClient } from './anthropic-chat-client';
import type { AssistantMessage, AssistantModelClient, AssistantModelRequest, AssistantModelResponse, AssistantToolCall } from './types';

// TODO(integrate): duplicates OPENAI_BASE_URL (private const in ai/providers/openai.ts).
const OPENAI_BASE_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

// TODO(integrate): duplicates isReasoningModel (private in ai/providers/openai.ts).
const isReasoningModel = (model: string): boolean => {
    const id = model.trim().toLowerCase();
    return id.startsWith('gpt-5') || /^o\d+(?:-|$)/.test(id);
};

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
            };
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
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
                if (!response.ok && RETRYABLE.has(response.status) && attempt < MAX_RETRIES) {
                    await waitForAIRequestRetry(400 * 2 ** attempt, request.signal, 'Assistant');
                    continue;
                }
                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) throw new Error('The AI endpoint rejected the request. Check the API key and model in AI settings.');
                    if (response.status === 429) throw new Error('AI rate limit or quota exceeded. Try again later.');
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
