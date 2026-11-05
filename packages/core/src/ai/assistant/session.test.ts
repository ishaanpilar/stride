import { describe, expect, it } from 'vitest';

import { AssistantSession, resolveAssistantReadiness } from './session';
import { createFakePort, createScriptedClient, toolCall } from './testing';
import type { ThreadStorage } from './conversation';

const memoryStorage = (): ThreadStorage => {
    const map = new Map<string, string>();
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
};

const make = (script: Parameters<typeof createScriptedClient>[0], seed: Parameters<typeof createFakePort>[0] = {}) => {
    const fake = createFakePort(seed);
    const { client } = createScriptedClient(script);
    const session = new AssistantSession({ storage: memoryStorage(), createClient: async () => client, createPort: () => fake.port });
    return { session, ...fake };
};

describe('AssistantSession', () => {
    it('gates delete behind confirmation, then confirms and undoes', async () => {
        const { session, tasks } = make([{ toolCalls: [toolCall('delete_task', { id: 'task1' })] }, { content: 'Please confirm.' }], { tasks: [{ title: 'Old' }] });
        await session.send('delete Old');
        expect(tasks[0].deletedAt).toBeUndefined();
        const [pending] = session.getState().thread.pending;
        expect(pending.status).toBe('pending');
        await session.confirm(pending.id);
        expect(tasks[0].deletedAt).toBeDefined();
        const entry = session.getState().thread.changes[0];
        expect(await session.undoEntry(entry.id)).toBeNull();
        expect(tasks[0].deletedAt).toBeUndefined();
    });

    it('rejecting a pending action leaves data untouched', async () => {
        const { session, tasks } = make([{ toolCalls: [toolCall('delete_task', { id: 'task1' })] }, { content: 'ok' }], { tasks: [{ title: 'Keep' }] });
        await session.send('delete Keep');
        session.reject(session.getState().thread.pending[0].id);
        expect(session.getState().thread.pending[0].status).toBe('rejected');
        expect(tasks[0].deletedAt).toBeUndefined();
    });

    it('surfaces client failure as an error message', async () => {
        const fake = createFakePort();
        const session = new AssistantSession({ storage: null, createClient: async () => { throw new Error('boom'); }, createPort: () => fake.port });
        await session.send('hi');
        const last = session.getState().thread.messages.at(-1)!;
        expect(last.isError).toBe(true);
        expect(session.getState().busy).toBe(false);
    });

    it('undoes a whole turn and clears on new chat', async () => {
        const { session, tasks } = make([{ toolCalls: [toolCall('add_task', { title: 'Buy milk' })] }, { content: 'Added.' }]);
        await session.send('add milk');
        expect(tasks.some((t) => t.title === 'Buy milk')).toBe(true);
        const turnId = session.getState().thread.messages[0].turnId!;
        expect(await session.undoTurn(turnId)).toBeNull();
        expect(tasks.find((t) => t.title === 'Buy milk')!.deletedAt).toBeDefined();
        session.newChat();
        expect(session.getState().thread.messages).toHaveLength(0);
    });
});

describe('resolveAssistantReadiness', () => {
    const settings = (ai: Record<string, unknown>) => ({ ai }) as never;
    it('reports disabled, no-key and ready', async () => {
        expect(await resolveAssistantReadiness(settings({ enabled: false }), async () => 'k')).toEqual({ ready: false, reason: 'disabled' });
        expect(await resolveAssistantReadiness(settings({ enabled: true, provider: 'openai' }), async () => '')).toEqual({ ready: false, reason: 'no-key' });
        expect(await resolveAssistantReadiness(settings({ enabled: true, provider: 'openai' }), async () => 'k')).toEqual({ ready: true });
        expect(await resolveAssistantReadiness(settings({ enabled: true, provider: 'gemini' }), async () => 'k')).toEqual({ ready: false, reason: 'unsupported-provider' });
    });
});
