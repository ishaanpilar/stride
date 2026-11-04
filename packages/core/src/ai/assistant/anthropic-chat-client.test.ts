import { describe, expect, it } from 'vitest';

import {
    createAnthropicChatClient,
    parseAnthropicMessage,
    toAnthropicRequestParts,
    toAnthropicSchema,
} from './anthropic-chat-client';
import { createAssistantChatClient, isAssistantProviderSupported } from './chat-client';
import type { AssistantMessage } from './types';

const thinkingBlock = { type: 'thinking', thinking: '', signature: 'sig-abc' };
const toolUseBlock = { type: 'tool_use', id: 'toolu_1', name: 'list_tasks', input: { status: 'next' } };

describe('anthropic request translation', () => {
    it('moves system messages to the top level and keeps the conversation user-first', () => {
        const parts = toAnthropicRequestParts([
            { role: 'system', content: 'You are Stride.' },
            { role: 'assistant', content: 'stale leading reply' },
            { role: 'user', content: 'What is urgent?' },
        ]);
        expect(parts.system).toBe('You are Stride.');
        expect(parts.messages).toEqual([{ role: 'user', content: 'What is urgent?' }]);
    });

    it('replays raw assistant blocks unchanged (thinking included) and groups tool results into one user turn', () => {
        const assistant: AssistantMessage = {
            role: 'assistant',
            content: null,
            toolCalls: [
                { id: 'toolu_1', name: 'list_tasks', arguments: '{"status":"next"}' },
                { id: 'toolu_2', name: 'list_projects', arguments: '{}' },
            ],
            providerBlocks: [thinkingBlock, toolUseBlock, { type: 'tool_use', id: 'toolu_2', name: 'list_projects', input: {} }],
        };
        const parts = toAnthropicRequestParts([
            { role: 'user', content: 'Plan my day' },
            assistant,
            { role: 'tool', toolCallId: 'toolu_1', content: '{"ok":true,"tasks":[]}' },
            { role: 'tool', toolCallId: 'toolu_2', content: '{"error":"Unknown project"}' },
        ]);
        expect(parts.messages).toHaveLength(3);
        expect(parts.messages[1]).toEqual({ role: 'assistant', content: assistant.providerBlocks });
        expect(parts.messages[1].content[0]).toBe(thinkingBlock);
        expect(parts.messages[2]).toEqual({
            role: 'user',
            content: [
                { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true,"tasks":[]}' },
                { type: 'tool_result', tool_use_id: 'toolu_2', content: '{"error":"Unknown project"}', is_error: true },
            ],
        });
    });

    it('rebuilds tool_use blocks from tool calls when no raw blocks are available', () => {
        const parts = toAnthropicRequestParts([
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'Checking.', toolCalls: [{ id: 't1', name: 'get_today_overview', arguments: 'not json' }] },
        ]);
        expect(parts.messages[1]).toEqual({
            role: 'assistant',
            content: [
                { type: 'text', text: 'Checking.' },
                { type: 'tool_use', id: 't1', name: 'get_today_overview', input: {} },
            ],
        });
    });

    it('converts nullable fields to JSON Schema type unions', () => {
        const schema = toAnthropicSchema({
            type: 'object',
            properties: { dueDate: { type: 'string', nullable: true }, tags: { type: 'array', items: { type: 'string' } } },
            required: ['dueDate'],
        });
        expect(schema).toEqual({
            type: 'object',
            properties: { dueDate: { type: ['string', 'null'] }, tags: { type: 'array', items: { type: 'string' } } },
            required: ['dueDate'],
        });
    });
});

describe('anthropic response parsing', () => {
    it('extracts text and tool calls and keeps the raw blocks for replay', () => {
        const content = [thinkingBlock, { type: 'text', text: 'Let me look.' }, toolUseBlock];
        const r = parseAnthropicMessage(JSON.stringify({ content, stop_reason: 'tool_use' }));
        expect(r.message.content).toBe('Let me look.');
        expect(r.message.toolCalls).toEqual([{ id: 'toolu_1', name: 'list_tasks', arguments: '{"status":"next"}' }]);
        expect(r.message.providerBlocks).toEqual(content);
    });

    it('turns a refusal into a plain reply with no tool calls', () => {
        const r = parseAnthropicMessage(JSON.stringify({
            content: [],
            stop_reason: 'refusal',
            stop_details: { type: 'refusal', category: null, explanation: 'Policy.' },
        }));
        expect(r.message.toolCalls).toBeUndefined();
        expect(r.message.content).toContain("can't help");
    });

    it('never executes a tool call from a reply cut off by max_tokens', () => {
        const r = parseAnthropicMessage(JSON.stringify({ content: [toolUseBlock], stop_reason: 'max_tokens' }));
        expect(r.message.toolCalls).toBeUndefined();
        expect(r.message.content).toBeTruthy();
    });
});

describe('anthropic chat client', () => {
    it('posts a tool-calling request with the direct-browser headers via injected fetch (no network)', async () => {
        let seen: { url: string; body: any; headers: Record<string, string> } | undefined;
        const fetcher = (async (url: string, init: RequestInit) => {
            seen = { url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> };
            return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' }), { status: 200 });
        }) as unknown as typeof fetch;
        const client = createAnthropicChatClient({ provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-sonnet-5', fetcher });
        const res = await client.complete({
            messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'yo' }],
            tools: [{ name: 'list_tasks', description: 'List tasks', parameters: { type: 'object', properties: {} } }],
        });
        expect(res.message.content).toBe('Done.');
        expect(seen?.url).toBe('https://api.anthropic.com/v1/messages');
        expect(seen?.headers['x-api-key']).toBe('sk-ant-test');
        expect(seen?.headers['anthropic-version']).toBe('2023-06-01');
        expect(seen?.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
        expect(seen?.body).toMatchObject({
            model: 'claude-sonnet-5',
            system: 'sys',
            tool_choice: { type: 'auto' },
            tools: [{ name: 'list_tasks', description: 'List tasks', input_schema: { type: 'object', properties: {} } }],
        });
        expect(seen?.body.temperature).toBeUndefined();
        expect(seen?.body.thinking).toBeUndefined();
    });

    it('sends adaptive thinking on current models when thinking is turned on', async () => {
        let body: any;
        const fetcher = (async (_url: string, init: RequestInit) => {
            body = JSON.parse(String(init.body));
            return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }), { status: 200 });
        }) as unknown as typeof fetch;
        const client = createAnthropicChatClient({ provider: 'anthropic', apiKey: 'k', model: 'claude-opus-5-5', thinkingBudget: 2048, fetcher });
        await client.complete({ messages: [{ role: 'user', content: 'hi' }], tools: [] });
        expect(body.thinking).toEqual({ type: 'adaptive' });
    });

    it('requires an API key', () => {
        expect(() => createAnthropicChatClient({ provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5' })).toThrow(/API key/);
    });
});

describe('assistant provider routing', () => {
    it('supports OpenAI-compatible and Anthropic providers, not Gemini yet', () => {
        expect(isAssistantProviderSupported({ provider: 'openai' })).toBe(true);
        expect(isAssistantProviderSupported({ provider: 'anthropic' })).toBe(true);
        expect(isAssistantProviderSupported({ provider: 'gemini' })).toBe(false);
    });

    it('builds the Anthropic client for the anthropic provider', async () => {
        let url = '';
        const fetcher = (async (u: string) => {
            url = u;
            return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }), { status: 200 });
        }) as unknown as typeof fetch;
        const client = createAssistantChatClient({ provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5', fetcher });
        await client.complete({ messages: [{ role: 'user', content: 'hi' }], tools: [] });
        expect(url).toBe('https://api.anthropic.com/v1/messages');
    });
});
