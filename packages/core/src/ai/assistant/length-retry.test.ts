import { describe, expect, it } from 'vitest';

import { runAssistantTurn } from './agent';
import { AssistantChangeLog } from './change-log';
import { openAIAssistantTokenLimit } from './chat-client';
import { ASSISTANT_MAX_OUTPUT_TOKENS, LENGTH_RETRY_NOTE, MAX_LENGTH_RETRIES } from './guardrails';
import { createFakePort, toolCall } from './testing';
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from './types';

const NOW = new Date(2026, 10, 4, 9, 30, 0);

function clientFrom(responses: AssistantModelResponse[]) {
    const requests: AssistantModelRequest[] = [];
    let i = 0;
    const client: AssistantModelClient = {
        async complete(req) {
            requests.push({ ...req, messages: [...req.messages] });
            const next = responses[Math.min(i, responses.length - 1)];
            i += 1;
            return next;
        },
    };
    return { client, requests };
}

const cutOff: AssistantModelResponse = {
    finishReason: 'length',
    message: { role: 'assistant', content: 'My reply was too long and got cut off. Try asking for less at once.' },
};

describe('assistant length retry', () => {
    it('asks the model to continue in smaller steps instead of giving up', async () => {
        const { port, tasks } = createFakePort();
        const { client, requests } = clientFrom([
            cutOff,
            { message: { role: 'assistant', content: null, toolCalls: [toolCall('add_task', { title: 'Check brand protection for the 17th' })] } },
            { message: { role: 'assistant', content: 'Added it.' } },
        ]);
        const result = await runAssistantTurn({ client, port, changeLog: new AssistantChangeLog(), userText: 'Is brand protection on/off on 17th', messageId: 'm1', now: NOW });
        expect(result.status).toBe('ok');
        expect(tasks).toHaveLength(1);
        expect(requests[1].messages.at(-1)).toMatchObject({ role: 'user', content: LENGTH_RETRY_NOTE });
        expect(requests[1].messages.some((m) => m.content?.includes('got cut off'))).toBe(false);
    });

    it('stops with a helpful message after repeated cut-offs and keeps changes already made', async () => {
        const { port } = createFakePort();
        const { client, requests } = clientFrom([cutOff]);
        const result = await runAssistantTurn({ client, port, changeLog: new AssistantChangeLog(), userText: 'do everything', messageId: 'm1', now: NOW });
        expect(result.status).toBe('error');
        expect(result.reply).toMatch(/too much to do in one go/);
        expect(requests).toHaveLength(MAX_LENGTH_RETRIES + 1);
    });

    it('gives DeepSeek models room for hidden thinking on top of the reply cap', () => {
        expect(openAIAssistantTokenLimit({ model: 'deepseek-v4-pro', official: false, extra: {} }).max_tokens).toBeGreaterThan(ASSISTANT_MAX_OUTPUT_TOKENS);
        expect(openAIAssistantTokenLimit({ model: 'gpt-4.1-mini', official: true, extra: {} }).max_completion_tokens).toBe(ASSISTANT_MAX_OUTPUT_TOKENS);
    });
});
