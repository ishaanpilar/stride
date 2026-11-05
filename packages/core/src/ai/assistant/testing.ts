import { generateUUID } from '../../uuid';
import type { Area, Person, Project, Task } from '../../types';
import type { AssistantMessage, AssistantModelClient, AssistantModelRequest, AssistantModelResponse, AssistantStorePort } from './types';

/** In-memory AssistantStorePort for tests (mimics store semantics: undefined clears a field, delete is soft). */
export function createFakePort(seed: { tasks?: Partial<Task>[]; projects?: Partial<Project>[]; areas?: Area[]; people?: Person[] } = {}) {
    const stamp = '2026-01-01T00:00:00.000Z';
    const tasks: Task[] = (seed.tasks ?? []).map((t, i) => ({
        id: `task${i + 1}-0000-0000-0000-000000000000`, title: `Task ${i + 1}`, status: 'next', tags: [], contexts: [], createdAt: stamp, updatedAt: stamp, ...t,
    }) as Task);
    const projects: Project[] = (seed.projects ?? []).map((p, i) => ({
        id: `proj${i + 1}-0000-0000-0000-000000000000`, title: `Project ${i + 1}`, status: 'active', color: '#fff', order: i, tagIds: [], createdAt: stamp, updatedAt: stamp, ...p,
    }) as Project);
    const areas: Area[] = [...(seed.areas ?? [])];
    const people: Person[] = [...(seed.people ?? [])];
    const calls: string[] = [];
    const port: AssistantStorePort = {
        getSnapshot: () => ({ tasks: tasks.map((t) => ({ ...t })), projects: projects.map((p) => ({ ...p })), areas, people }),
        async addTask(title, props) {
            calls.push('addTask');
            const t = { id: generateUUID(), title, status: 'inbox', tags: [], contexts: [], createdAt: stamp, updatedAt: stamp, ...props } as Task;
            tasks.push(t);
            return { success: true, id: t.id };
        },
        async updateTask(id, updates) {
            calls.push('updateTask');
            const t = tasks.find((x) => x.id === id);
            if (!t) return { success: false, error: 'Task not found' };
            for (const [k, v] of Object.entries(updates)) {
                if (v === undefined) delete (t as any)[k];
                else (t as any)[k] = v;
            }
            return { success: true };
        },
        async completeTask(id) {
            calls.push('completeTask');
            const t = tasks.find((x) => x.id === id);
            if (!t) return { success: false, error: 'Task not found' };
            t.status = 'done';
            t.completedAt = stamp;
            return { success: true };
        },
        async deleteTask(id) {
            calls.push('deleteTask');
            const t = tasks.find((x) => x.id === id);
            if (!t) return { success: false, error: 'Task not found' };
            t.deletedAt = stamp;
            return { success: true };
        },
        async restoreTask(id) {
            const t = tasks.find((x) => x.id === id);
            if (!t) return { success: false, error: 'Task not found' };
            delete t.deletedAt;
            return { success: true };
        },
        async addProject(title, color, props) {
            const p = { id: generateUUID(), title, color, status: 'active', order: projects.length, tagIds: [], createdAt: stamp, updatedAt: stamp, ...props } as Project;
            projects.push(p);
            return p;
        },
        async deleteProject(id) {
            const p = projects.find((x) => x.id === id);
            if (!p) return { success: false, error: 'Project not found' };
            p.deletedAt = stamp;
            for (const t of tasks) if (t.projectId === id) t.deletedAt = stamp;
            return { success: true };
        },
        async restoreProject(id) {
            const p = projects.find((x) => x.id === id);
            if (!p) return { success: false, error: 'Project not found' };
            delete p.deletedAt;
            return { success: true };
        },
        async updateProject(id, updates) {
            calls.push('updateProject');
            const p = projects.find((x) => x.id === id);
            if (!p) return { success: false, error: 'Project not found' };
            for (const [k, v] of Object.entries(updates)) {
                if (v === undefined) delete (p as any)[k];
                else (p as any)[k] = v;
            }
            return { success: true };
        },
        async addArea(name, props) {
            const a = { id: generateUUID(), name, order: areas.length, createdAt: stamp, updatedAt: stamp, ...props } as Area;
            areas.push(a);
            return a;
        },
        async updateArea(id, updates) {
            const a = areas.find((x) => x.id === id);
            if (!a) return { success: false, error: 'Area not found' };
            for (const [k, v] of Object.entries(updates)) {
                if (v === undefined) delete (a as any)[k];
                else (a as any)[k] = v;
            }
            return { success: true };
        },
        async deleteArea(id) {
            calls.push('deleteArea');
            const a = areas.find((x) => x.id === id);
            if (!a) return { success: false, error: 'Area not found' };
            a.deletedAt = stamp;
            return { success: true };
        },
        async restoreArea(id) {
            const a = areas.find((x) => x.id === id);
            if (!a) return { success: false, error: 'Area not found' };
            delete a.deletedAt;
            return { success: true };
        },
        async addPerson(name) {
            calls.push('addPerson');
            const person = { id: generateUUID(), name, createdAt: stamp, updatedAt: stamp } as Person;
            people.push(person);
            return person;
        },
        async deletePerson(id) {
            calls.push('deletePerson');
            const person = people.find((x) => x.id === id);
            if (!person) return { success: false, error: 'Person not found' };
            person.deletedAt = stamp;
            return { success: true };
        },
    };
    return { port, tasks, projects, areas, people, calls };
}

export type ScriptedReply = Partial<AssistantMessage> | ((req: AssistantModelRequest) => Partial<AssistantMessage>);

/** Mock model: returns scripted assistant messages in order and records requests. */
export function createScriptedClient(script: ScriptedReply[]) {
    const requests: AssistantModelRequest[] = [];
    let i = 0;
    const client: AssistantModelClient = {
        async complete(req): Promise<AssistantModelResponse> {
            requests.push({ ...req, messages: [...req.messages] });
            const next = script[Math.min(i, script.length - 1)];
            i += 1;
            const msg = typeof next === 'function' ? next(req) : next;
            return { message: { role: 'assistant', content: null, ...msg } };
        },
    };
    return { client, requests };
}

export const toolCall = (name: string, args: unknown, id = `call_${Math.random().toString(36).slice(2, 8)}`) => ({
    id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args),
});
