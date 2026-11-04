import { describe, expect, it } from 'vitest';

import { runAssistantTurn, executeConfirmed, capHistory, runToolCall } from './agent';
import { AssistantChangeLog } from './change-log';
import { parseToolArguments, validateAgainstSchema } from './schema';
import { ASSISTANT_TOOLS } from './tools';
import { parseWhen } from './dates';
import { parseChatCompletion, toWireMessage, createOpenAICompatibleChatClient } from './chat-client';
import { loadThread, saveThread, clearThread, toModelHistory, emptyThread } from './conversation';
import { createFakePort, createScriptedClient, toolCall } from './testing';

// Wed 4 Nov 2026, 09:30 local
const NOW = new Date(2026, 10, 4, 9, 30, 0);

const run = (port: ReturnType<typeof createFakePort>['port'], log: AssistantChangeLog, script: Parameters<typeof createScriptedClient>[0], text = 'go', history = []) => {
    const { client, requests } = createScriptedClient(script);
    return runAssistantTurn({ client, port, changeLog: log, userText: text, messageId: 'm1', now: NOW, history }).then((r) => ({ ...r, requests }));
};
const exec = (port: any, log: AssistantChangeLog, name: string, args: unknown) =>
    runToolCall({ name, rawArguments: JSON.stringify(args), tools: ASSISTANT_TOOLS, ctx: { port, now: NOW }, changeLog: log, messageId: 'm1' });

describe('schema + argument repair', () => {
  it('coerces numeric/boolean strings and wraps lone strings', () => {
    const r = validateAgainstSchema({ type: 'object', properties: { n: { type: 'integer' }, b: { type: 'boolean' }, a: { type: 'array', items: { type: 'string' } } } }, { n: '5', b: 'true', a: 'x' });
    expect(r).toEqual({ ok: true, value: { n: 5, b: true, a: ['x'] } });
  });
  it('rejects unknown properties and bad enums', () => {
    expect(validateAgainstSchema({ type: 'object', properties: { s: { type: 'string', enum: ['a'] } } }, { zzz: 1 }).ok).toBe(false);
    expect(validateAgainstSchema({ type: 'object', properties: { s: { type: 'string', enum: ['a'] } } }, { s: 'b' }).ok).toBe(false);
  });
  it('repairs fenced / trailing-comma JSON', () => {
    expect(parseToolArguments('```json\n{"a":1,}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseToolArguments('sure: {"a": 2}')).toEqual({ ok: true, value: { a: 2 } });
    expect(parseToolArguments('not json').ok).toBe(false);
  });
});

describe('date validation', () => {
  it('accepts date and datetime, rejects bad/past/garbage', () => {
    expect(parseWhen('2026-11-06T17:00', NOW)).toMatchObject({ ok: true, value: '2026-11-06T17:00', hasTime: true });
    expect(parseWhen('2026-11-20', NOW)).toMatchObject({ ok: true, value: '2026-11-20' });
    expect(parseWhen('2026-02-30', NOW).ok).toBe(false);
    expect(parseWhen('2025-11-06', NOW).ok).toBe(false);
    expect(parseWhen('friday', NOW).ok).toBe(false);
    expect(parseWhen('2026-11-06T25:00', NOW).ok).toBe(false);
  });
});

describe('tool validators', () => {
  it('add_task rejects reminder without a time and unknown project', async () => {
    const { port } = createFakePort();
    const log = new AssistantChangeLog();
    const a = await exec(port, log, 'add_task', { title: 'Dentist', dueDate: '2026-11-06', remind: true });
    expect(a.ok).toBe(false);
    expect(a.content).toContain('needs a time');
    const b = await exec(port, log, 'add_task', { title: 'X', projectId: 'nope' });
    expect(b.ok).toBe(false);
    expect(b.content).toContain('Unknown project');
    expect(log.list()).toHaveLength(0);
  });
  it('add_task creates with due, reminder and chip label', async () => {
    const { port, tasks } = createFakePort();
    const log = new AssistantChangeLog();
    const r = await exec(port, log, 'add_task', { title: 'Dentist', dueDate: '2026-11-06T17:00', remind: true, contexts: ['health'] });
    expect(r.ok).toBe(true);
    expect(tasks[0]).toMatchObject({ title: 'Dentist', dueDate: '2026-11-06T17:00', reminderPolicy: 'send', status: 'next', contexts: ['@health'] });
    expect(r.entry?.label).toBe("Added 'Dentist' · Fri 6 Nov, 17:00 · reminder");
  });
  it('update/complete/get reject unknown task ids and past dates', async () => {
    const { port } = createFakePort({ tasks: [{ title: 'A' }] });
    const log = new AssistantChangeLog();
    expect((await exec(port, log, 'update_task', { id: 'ghost-id', title: 'z' })).content).toContain('Unknown task id');
    expect((await exec(port, log, 'complete_task', { id: 'ghost-id' })).ok).toBe(false);
    expect((await exec(port, log, 'update_task', { id: 'task1', dueDate: '2020-01-01' })).content).toContain('past');
    expect((await exec(port, log, 'update_task', { id: 'task1' })).content).toContain('Nothing to change');
  });
  it('resolves unique id prefixes', async () => {
    const { port } = createFakePort({ tasks: [{ title: 'Invoice' }] });
    const log = new AssistantChangeLog();
    expect((await exec(port, log, 'complete_task', { id: 'task1-00' })).ok).toBe(true);
  });
  it('list_tasks filters by search / due range / overdue', async () => {
    const { port } = createFakePort({ tasks: [
      { title: 'Pay invoice', dueDate: '2026-11-02' },
      { title: 'Call mom', dueDate: '2026-11-04T18:00' },
      { title: 'Plan trip', dueDate: '2026-11-20' },
      { title: 'Done thing', status: 'done' },
    ] });
    const log = new AssistantChangeLog();
    const parse = (r: any) => JSON.parse(r.content);
    expect(parse(await exec(port, log, 'list_tasks', { search: 'invoice' })).tasks).toHaveLength(1);
    expect(parse(await exec(port, log, 'list_tasks', { overdue: true })).tasks.map((t: any) => t.title)).toEqual(['Pay invoice']);
    expect(parse(await exec(port, log, 'list_tasks', { dueFrom: '2026-11-04', dueTo: '2026-11-10' })).total).toBe(1);
    expect(parse(await exec(port, log, 'list_tasks', {})).total).toBe(3);
  });
  it('get_today_overview groups overdue / today / upcoming', async () => {
    const { port } = createFakePort({ tasks: [{ title: 'Late', dueDate: '2026-11-01' }, { title: 'Now', dueDate: '2026-11-04' }, { title: 'Soon', dueDate: '2026-11-08' }] });
    const d = JSON.parse((await exec(port, new AssistantChangeLog(), 'get_today_overview', {})).content);
    expect([d.overdue.count, d.today.count, d.upcoming.count]).toEqual([1, 1, 1]);
  });
  it('breakdown_task appends checklist; subtasks mode creates tasks', async () => {
    const { port, tasks } = createFakePort({ tasks: [{ title: 'Prepare tax return' }] });
    const log = new AssistantChangeLog();
    await exec(port, log, 'breakdown_task', { id: 'task1', steps: ['Gather W2', 'File'] });
    expect(tasks[0].checklist?.map((c) => c.title)).toEqual(['Gather W2', 'File']);
    await exec(port, log, 'breakdown_task', { id: 'task1', steps: ['Call accountant'], mode: 'tasks' });
    expect(tasks.some((t) => t.title === 'Call accountant')).toBe(true);
  });
});

describe('agent loop', () => {
  it('runs a scripted multi-step plan (project + tasks) and replies', async () => {
    const { port, tasks, projects } = createFakePort();
    const log = new AssistantChangeLog();
    const r = await run(port, log, [
      { toolCalls: [toolCall('get_today_overview', {})] },
      { toolCalls: [toolCall('add_project', { title: 'Launch website', dueDate: '2026-11-20', nextActions: [{ title: 'Draft copy', dueDate: '2026-11-10' }, 'Deploy', { title: 'QA', dueDate: '2026-11-18' }] })] },
      { content: 'Created the Launch website project with 3 steps.' },
    ]);
    expect(r.status).toBe('ok');
    expect(r.steps).toBe(3);
    expect(projects).toHaveLength(1);
    expect(tasks.map((t) => t.title)).toEqual(['Draft copy', 'Deploy', 'QA']);
    expect(tasks.every((t) => t.projectId === projects[0].id)).toBe(true);
    expect(r.reply).toContain('Launch website');
    expect(r.entries).toHaveLength(1);
    // system prompt carries date + tz-aware context and tools are offered
    expect(r.requests[0].messages[0].content).toContain('2026-11-04T09:30');
    expect(r.requests[0].tools.map((t) => t.name)).toContain('move_tasks');
  });

  it('feeds malformed + invalid calls back as tool results so the model can retry', async () => {
    const { port, tasks } = createFakePort();
    const log = new AssistantChangeLog();
    const r = await run(port, log, [
      { toolCalls: [toolCall('add_task', '{oops'), toolCall('add_task', { title: 'Dentist', dueDate: 'Friday' }), toolCall('nope', {})] },
      { toolCalls: [toolCall('add_task', { title: 'Dentist', dueDate: '2026-11-06T17:00', remind: true })] },
      { content: 'Added.' },
    ]);
    expect(tasks).toHaveLength(1);
    const toolMsgs = r.requests[1].messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(3);
    expect(toolMsgs[0].content).toContain('not valid JSON');
    expect(toolMsgs[1].content).toContain('not a valid date');
    expect(toolMsgs[2].content).toContain('Unknown tool');
    expect(r.status).toBe('ok');
  });

  it('caps steps', async () => {
    const { port } = createFakePort();
    const { client } = createScriptedClient([{ toolCalls: [toolCall('list_projects', {})] }]);
    const r = await runAssistantTurn({ client, port, changeLog: new AssistantChangeLog(), userText: 'x', messageId: 'm', now: NOW, maxSteps: 3 });
    expect(r.status).toBe('max_steps');
    expect(r.steps).toBe(3);
  });

  it('times out a stuck model call', async () => {
    const { port } = createFakePort();
    const client = { complete: () => new Promise<never>(() => {}) };
    const r = await runAssistantTurn({ client, port, changeLog: new AssistantChangeLog(), userText: 'x', messageId: 'm', now: NOW, callTimeoutMs: 20 });
    expect(r.status).toBe('error');
    expect(r.error).toContain('timed out');
  });

  it('reports model errors without throwing', async () => {
    const { port } = createFakePort();
    const client = { complete: async () => { throw new Error('boom'); } };
    const r = await runAssistantTurn({ client, port, changeLog: new AssistantChangeLog(), userText: 'x', messageId: 'm', now: NOW });
    expect(r).toMatchObject({ status: 'error', error: 'boom' });
  });

  it('stops after repeated failures', async () => {
    const { port } = createFakePort();
    const { client } = createScriptedClient([{ toolCalls: [toolCall('complete_task', { id: 'ghost' })] }]);
    const r = await runAssistantTurn({ client, port, changeLog: new AssistantChangeLog(), userText: 'x', messageId: 'm', now: NOW });
    expect(r.status).toBe('error');
    expect(r.steps).toBe(5);
  });

  it('caps history sent to the model', () => {
    const h = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `m${i}` }));
    const c = capHistory(h, 10);
    expect(c.length).toBeLessThanOrEqual(10);
    expect(c[0].role).toBe('user');
  });
});

describe('confirmation gating', () => {
  const many = () => createFakePort({ tasks: [{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }, { title: 'e' }] });

  it('delete_task never executes until confirmed', async () => {
    const { port, tasks, calls } = createFakePort({ tasks: [{ title: 'Old' }] });
    const log = new AssistantChangeLog();
    const r = await run(port, log, [{ toolCalls: [toolCall('delete_task', { id: 'task1' })] }, { content: 'Please confirm deletion.' }]);
    expect(r.pending).toHaveLength(1);
    expect(r.pending[0].summary).toBe("Delete 'Old'");
    expect(tasks[0].deletedAt).toBeUndefined();
    expect(calls).not.toContain('deleteTask');
    expect(r.entries).toHaveLength(0);
    const res = await executeConfirmed(r.pending[0], { port, changeLog: log, now: NOW });
    expect(res.ok).toBe(true);
    expect(tasks[0].deletedAt).toBeDefined();
    expect(log.list()).toHaveLength(1);
  });

  it('bulk >3 gates, <=3 executes immediately', async () => {
    const { port, tasks } = many();
    const log = new AssistantChangeLog();
    const ids = tasks.map((t) => t.id);
    const r = await run(port, log, [{ toolCalls: [toolCall('move_tasks', { ids, dueDate: '2026-11-11' })] }, { content: 'Confirm?' }]);
    expect(r.pending[0].affected).toHaveLength(5);
    expect(tasks.every((t) => !t.dueDate)).toBe(true);
    const ok = await executeConfirmed(r.pending[0], { port, changeLog: log, now: NOW });
    expect(ok.ok).toBe(true);
    expect(tasks.every((t) => t.dueDate === '2026-11-11')).toBe(true);

    const small = many();
    const l2 = new AssistantChangeLog();
    const r2 = await run(small.port, l2, [{ toolCalls: [toolCall('move_tasks', { ids: small.tasks.slice(0, 3).map((t) => t.id), shiftDays: 7 })] }, { content: 'Done' }]);
    expect(r2.pending).toHaveLength(0);
    expect(r2.entries).toHaveLength(1);
    expect(small.tasks[0].dueDate).toBe('2026-11-11');
  });

  it('confirmed execution re-validates against fresh state', async () => {
    const { port, tasks } = createFakePort({ tasks: [{ title: 'Old' }] });
    const log = new AssistantChangeLog();
    const r = await run(port, log, [{ toolCalls: [toolCall('delete_task', { id: 'task1' })] }, { content: 'ok' }]);
    tasks.length = 0;
    expect((await executeConfirmed(r.pending[0], { port, changeLog: log, now: NOW })).ok).toBe(false);
  });
});

describe('change log undo', () => {
  it('undoes add, update (incl. cleared fields), complete, delete and project creation', async () => {
    const { port, tasks, projects } = createFakePort({ tasks: [{ title: 'Invoice', dueDate: '2026-11-09', priority: 'low' }, { title: 'Other' }] });
    const log = new AssistantChangeLog();
    const added = await exec(port, log, 'add_task', { title: 'New' });
    const upd = await exec(port, log, 'update_task', { id: 'task1', dueDate: null, priority: 'urgent', startTime: '2026-11-05' });
    const done = await exec(port, log, 'complete_task', { id: 'task2' });
    const proj = await exec(port, log, 'add_project', { title: 'P', nextActions: ['one'] });
    expect(tasks[0].dueDate).toBeUndefined();
    expect(tasks[0].startTime).toBe('2026-11-05');

    await log.undo(upd.entry!.id, port);
    expect(tasks[0]).toMatchObject({ dueDate: '2026-11-09', priority: 'low' });
    expect(tasks[0].startTime).toBeUndefined();
    await log.undo(done.entry!.id, port);
    expect(tasks[1].status).toBe('next');
    expect(tasks[1].completedAt).toBeUndefined();
    await log.undo(added.entry!.id, port);
    expect(tasks.find((t) => t.title === 'New')!.deletedAt).toBeDefined();
    await log.undo(proj.entry!.id, port);
    expect(projects[0].deletedAt).toBeDefined();
    expect(log.list().every((e) => e.undone)).toBe(true);
  });

  it('undo all from one message, newest first; delete undo restores', async () => {
    const { port, tasks } = createFakePort({ tasks: [{ title: 'A', dueDate: '2026-11-09' }, { title: 'B' }] });
    const log = new AssistantChangeLog();
    await exec(port, log, 'update_task', { id: 'task1', dueDate: '2026-11-12' });
    await exec(port, log, 'update_task', { id: 'task1', dueDate: '2026-11-15' });
    const del = await exec(port, log, 'delete_task', { id: 'task2' });
    expect(del.pending).toBeDefined();
    await executeConfirmed(del.pending!, { port, changeLog: log, now: NOW });
    expect(tasks[1].deletedAt).toBeDefined();
    const res = await log.undoMessage('m1', port);
    expect(res.ok).toBe(true);
    expect(tasks[0].dueDate).toBe('2026-11-09');
    expect(tasks[1].deletedAt).toBeUndefined();
  });

  it('move_tasks keeps time of day and undoes per task', async () => {
    const { port, tasks } = createFakePort({ tasks: [{ title: 'A', dueDate: '2026-11-05T14:00' }, { title: 'B' }] });
    const log = new AssistantChangeLog();
    const r = await exec(port, log, 'move_tasks', { ids: [tasks[0].id, tasks[1].id], dueDate: '2026-11-12' });
    expect(tasks[0].dueDate).toBe('2026-11-12T14:00');
    expect(tasks[1].dueDate).toBe('2026-11-12');
    await log.undo(r.entry!.id, port);
    expect(tasks[0].dueDate).toBe('2026-11-05T14:00');
    expect(tasks[1].dueDate).toBeUndefined();
  });
});

describe('conversation persistence', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
  it('round-trips per day, clears on new chat, builds lean model history', () => {
    const s = mem();
    const t = emptyThread('2026-11-04');
    t.messages.push({ id: '1', role: 'user', text: 'hi', createdAt: 'x', turnId: 't1' }, { id: '2', role: 'assistant', text: 'Added.', createdAt: 'x', turnId: 't1' });
    t.changes.push({ id: 'c', messageId: 't1', toolName: 'add_task', label: "Added 'A'", at: 'x', undone: false, undoOps: [], changes: [{ taskId: 'abcdef123456', title: 'A', before: {}, after: {} }] });
    saveThread(s, t);
    const loaded = loadThread(s, NOW);
    expect(loaded.messages).toHaveLength(2);
    expect(toModelHistory(loaded)[1].content).toContain('[abcdef12]');
    expect(loadThread(s, new Date(2026, 10, 5)).messages).toHaveLength(0);
    expect(clearThread(s, NOW).messages).toHaveLength(0);
    expect(loadThread(s, NOW).messages).toHaveLength(0);
  });
});

describe('openai-compatible chat client', () => {
  it('parses tool_calls and reasoning_content; serializes tool messages', () => {
    const r = parseChatCompletion(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, reasoning_content: 'think', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_tasks', arguments: '{}' } }] } }] }));
    expect(r.message.toolCalls?.[0]).toEqual({ id: 'c1', name: 'list_tasks', arguments: '{}' });
    expect(toWireMessage(r.message)).toMatchObject({ role: 'assistant', reasoning_content: 'think', tool_calls: [{ id: 'c1', function: { name: 'list_tasks' } }] });
    expect(toWireMessage({ role: 'tool', toolCallId: 'c1', content: 'x' })).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'x' });
  });
  it('posts tools to the configured endpoint via injected fetch (no network)', async () => {
    let seen: any;
    const fetcher = (async (_url: any, init: any) => {
      seen = { url: _url, body: JSON.parse(init.body), auth: init.headers.Authorization };
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createOpenAICompatibleChatClient({ provider: 'openai', apiKey: 'k', model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/chat/completions', fetcher });
    const res = await client.complete({ messages: [{ role: 'user', content: 'yo' }], tools: [{ name: 't', description: 'd', parameters: { type: 'object', properties: {} } }] });
    expect(res.message.content).toBe('hi');
    expect(seen.url).toBe('https://api.deepseek.com/chat/completions');
    expect(seen.body.tools[0].function.name).toBe('t');
    expect(seen.body.reasoning_effort).toBeUndefined();
    expect(seen.auth).toBe('Bearer k');
  });
  it('rejects non-openai providers', () => {
    expect(() => createOpenAICompatibleChatClient({ provider: 'gemini', apiKey: 'k', model: 'm' })).toThrow();
  });
});
