import { describe, expect, it, vi } from 'vitest';
import {
    AIRateLimitError,
    RATE_LIMIT_FALLBACK_SECONDS,
    formatRateLimitMessage,
    isAIRateLimitError,
    parseRetryAfterMs,
} from './provider-rate-limit';
import { createOpenAIProvider } from './providers/openai';
import { createAnthropicProvider } from './providers/anthropic';
import { createGeminiProvider } from './providers/gemini';
import { anthropicAssistantTokenLimits, createAnthropicChatClient } from './assistant/anthropic-chat-client';
import { createOpenAICompatibleChatClient, openAIAssistantTokenLimit } from './assistant/chat-client';
import { ASSISTANT_MAX_OUTPUT_TOKENS, ASSISTANT_THINKING_ALLOWANCE_TOKENS } from './assistant/guardrails';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const limited = (headers: Record<string, string> = {}, body: unknown = { error: { message: 'Rate limit reached', type: 'rate_limit_error' } }) => json(body, 429, headers);

const openAIText = (text: string) => json({ choices: [{ message: { content: text } }] });
const anthropicText = (text: string) => json({ content: [{ type: 'text', text }] });
const geminiText = (text: string) => json({ candidates: [{ content: { parts: [{ text }] } }] });

const queue = (...responses: Response[]) => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
        const next = responses.shift();
        if (!next) throw new Error('no more responses');
        return next;
    });
    return fetcher;
};

describe('parseRetryAfterMs', () => {
    it('reads seconds, milliseconds and HTTP dates', () => {
        expect(parseRetryAfterMs(new Headers({ 'retry-after': '3' }))).toBe(3000);
        expect(parseRetryAfterMs(new Headers({ 'retry-after-ms': '250' }))).toBe(250);
        const now = Date.parse('2026-11-05T10:00:00Z');
        expect(parseRetryAfterMs(new Headers({ 'retry-after': 'Thu, 05 Nov 2026 10:00:07 GMT' }), now)).toBe(7000);
        expect(parseRetryAfterMs(new Headers({ 'retry-after': 'soon' }))).toBeNull();
        expect(parseRetryAfterMs(new Headers())).toBeNull();
        expect(parseRetryAfterMs(null)).toBeNull();
    });

    it('formats a clear message', () => {
        expect(formatRateLimitMessage(12.2)).toBe('Your AI provider is rate-limiting requests. Try again in 13 s.');
        expect(formatRateLimitMessage(1, true)).toMatch(/out of quota or credits/);
    });
});

const providers = [
    { name: 'OpenAI', create: (fetcher: typeof fetch) => createOpenAIProvider({ provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini', fetcher }), ok: openAIText },
    { name: 'Anthropic', create: (fetcher: typeof fetch) => createAnthropicProvider({ provider: 'anthropic', apiKey: 'k', model: 'claude-haiku-4-5', fetcher }), ok: anthropicText },
    { name: 'Gemini', create: (fetcher: typeof fetch) => createGeminiProvider({ provider: 'gemini', apiKey: 'k', model: 'gemini-2.5-flash', fetcher }), ok: geminiText },
];

describe.each(providers)('$name provider 429 handling', ({ create, ok }) => {
    it('retries once after Retry-After and succeeds', async () => {
        const fetcher = queue(limited({ 'retry-after': '0' }), ok('{"x":1}'));
        const text = await create(fetcher as unknown as typeof fetch).generateText!({ system: 's', user: 'u' });
        expect(text).toBe('{"x":1}');
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('gives up after one retry with a friendly message naming the wait', async () => {
        const fetcher = queue(limited({ 'retry-after': '0' }), limited({ 'retry-after': '0.4' }), ok('never'));
        const error = await create(fetcher as unknown as typeof fetch).generateText!({ system: 's', user: 'u' }).catch((e) => e);
        expect(isAIRateLimitError(error)).toBe(true);
        expect(error.message).toBe('Your AI provider is rate-limiting requests. Try again in 1 s.');
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('does not wait on a long Retry-After', async () => {
        const fetcher = queue(limited({ 'retry-after': '120' }), ok('never'));
        const error = await create(fetcher as unknown as typeof fetch).generateText!({ system: 's', user: 'u' }).catch((e) => e);
        expect(error).toBeInstanceOf(AIRateLimitError);
        expect((error as AIRateLimitError).retryAfterSeconds).toBe(120);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('never retries a used-up quota', async () => {
        const fetcher = queue(limited({}, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } }), ok('never'));
        const error = await create(fetcher as unknown as typeof fetch).generateText!({ system: 's', user: 'u' }).catch((e) => e);
        expect((error as AIRateLimitError).quotaExhausted).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
});

describe('Assistant chat clients: 429 and output caps', () => {
    const toolReply = json({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] });

    it('OpenAI-compatible: retries a 429 once, then reports the wait', async () => {
        const fetcher = queue(limited({ 'retry-after': '0' }), limited({ 'retry-after': '5' }));
        const client = createOpenAICompatibleChatClient({ provider: 'openai', apiKey: 'k', model: 'deepseek-chat', endpoint: 'https://api.deepseek.com/chat/completions', fetcher: fetcher as unknown as typeof fetch });
        const error = await client.complete({ messages: [{ role: 'user', content: 'hi' }], tools: [] }).catch((e) => e);
        expect(error.message).toBe('Your AI provider is rate-limiting requests. Try again in 5 s.');
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('OpenAI-compatible: sends max_tokens to compatible endpoints and max_completion_tokens to OpenAI', async () => {
        const deepseek = queue(toolReply.clone());
        await createOpenAICompatibleChatClient({ provider: 'openai', apiKey: 'k', model: 'deepseek-chat', endpoint: 'https://api.deepseek.com/chat/completions', fetcher: deepseek as unknown as typeof fetch })
            .complete({ messages: [{ role: 'user', content: 'hi' }], tools: [] });
        expect(JSON.parse(String(deepseek.mock.calls[0][1]?.body)).max_tokens).toBe(ASSISTANT_MAX_OUTPUT_TOKENS);

        const openai = queue(toolReply.clone());
        await createOpenAICompatibleChatClient({ provider: 'openai', apiKey: 'k', model: 'gpt-5-mini', fetcher: openai as unknown as typeof fetch })
            .complete({ messages: [{ role: 'user', content: 'hi' }], tools: [] });
        const body = JSON.parse(String(openai.mock.calls[0][1]?.body));
        expect(body.max_completion_tokens).toBe(ASSISTANT_MAX_OUTPUT_TOKENS + ASSISTANT_THINKING_ALLOWANCE_TOKENS);
        expect(body.max_tokens).toBeUndefined();
    });

    it('OpenAI-compatible: thinking models get an allowance; an explicit user limit wins', () => {
        expect(openAIAssistantTokenLimit({ model: 'deepseek-reasoner', official: false, extra: {} })).toEqual({ max_tokens: ASSISTANT_MAX_OUTPUT_TOKENS + ASSISTANT_THINKING_ALLOWANCE_TOKENS });
        expect(openAIAssistantTokenLimit({ model: 'deepseek-chat', official: false, extra: { thinking: { type: 'enabled' } } }).max_tokens).toBe(ASSISTANT_MAX_OUTPUT_TOKENS + ASSISTANT_THINKING_ALLOWANCE_TOKENS);
        expect(openAIAssistantTokenLimit({ model: 'deepseek-chat', official: false, extra: { thinking: { type: 'disabled' } } }).max_tokens).toBe(ASSISTANT_MAX_OUTPUT_TOKENS);
        expect(openAIAssistantTokenLimit({ model: 'gpt-4o', official: true, extra: {} })).toEqual({ max_completion_tokens: ASSISTANT_MAX_OUTPUT_TOKENS });
        expect(openAIAssistantTokenLimit({ model: 'llama3', official: false, extra: { max_tokens: 4000 } })).toEqual({});
    });

    it('OpenAI-compatible: a reply cut off at the cap never runs its tool call', async () => {
        const fetcher = queue(json({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'delete_task', arguments: '{"id":' } }] }, finish_reason: 'length' }] }));
        const res = await createOpenAICompatibleChatClient({ provider: 'openai', apiKey: 'k', model: 'gpt-4o', fetcher: fetcher as unknown as typeof fetch })
            .complete({ messages: [{ role: 'user', content: 'hi' }], tools: [] });
        expect(res.message.toolCalls).toBeUndefined();
        expect(res.message.content).toMatch(/cut off/);
    });

    it('Anthropic: caps max_tokens (plus a thinking allowance on thinking models) and handles 429', async () => {
        expect(anthropicAssistantTokenLimits('claude-haiku-4-5', 0)).toEqual({ maxTokens: ASSISTANT_MAX_OUTPUT_TOKENS });
        expect(anthropicAssistantTokenLimits('claude-sonnet-5-5', 0).maxTokens).toBe(ASSISTANT_MAX_OUTPUT_TOKENS + ASSISTANT_THINKING_ALLOWANCE_TOKENS);
        expect(anthropicAssistantTokenLimits('claude-sonnet-5-5', 0).thinking).toBeUndefined();
        expect(anthropicAssistantTokenLimits('claude-sonnet-5-5', 2048).thinking).toEqual({ type: 'adaptive' });
        expect(anthropicAssistantTokenLimits('claude-haiku-4-5', 50_000)).toEqual({
            maxTokens: ASSISTANT_THINKING_ALLOWANCE_TOKENS + ASSISTANT_MAX_OUTPUT_TOKENS,
            thinking: { type: 'enabled', budget_tokens: ASSISTANT_THINKING_ALLOWANCE_TOKENS },
        });

        const fetcher = queue(limited({ 'retry-after': '0' }), json({ content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn' }));
        const client = createAnthropicChatClient({ provider: 'anthropic', apiKey: 'k', model: 'claude-haiku-4-5', fetcher: fetcher as unknown as typeof fetch });
        const res = await client.complete({ messages: [{ role: 'user', content: 'hi' }], tools: [] });
        expect(res.message.content).toBe('hello');
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).max_tokens).toBe(ASSISTANT_MAX_OUTPUT_TOKENS);
    });

    it('uses a fallback wait when the provider gives no Retry-After', async () => {
        const fetcher = queue(limited({ 'retry-after': '0' }), limited());
        const client = createAnthropicChatClient({ provider: 'anthropic', apiKey: 'k', model: 'claude-haiku-4-5', fetcher: fetcher as unknown as typeof fetch });
        const error = await client.complete({ messages: [{ role: 'user', content: 'hi' }], tools: [] }).catch((e) => e);
        expect(error.message).toBe(`Your AI provider is rate-limiting requests. Try again in ${RATE_LIMIT_FALLBACK_SECONDS} s.`);
    });
});
