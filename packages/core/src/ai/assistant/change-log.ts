import { generateUUID } from '../../uuid';
import type { Task } from '../../types';
import type { AssistantStorePort, ChangeEntry, ToolOutcome, UndoOp } from './types';

export type UndoResult = { ok: boolean; error?: string };

/** Records every executed mutation (before/after) and replays its inverse on demand. */
export class AssistantChangeLog {
    private entries: ChangeEntry[];
    private listeners = new Set<() => void>();

    constructor(initial: ChangeEntry[] = []) {
        this.entries = initial.map((e) => ({ ...e }));
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private emit() { this.listeners.forEach((l) => l()); }

    list(): ChangeEntry[] { return this.entries; }

    forMessage(messageId: string): ChangeEntry[] { return this.entries.filter((e) => e.messageId === messageId); }

    record(messageId: string, toolName: string, change: NonNullable<ToolOutcome['change']>): ChangeEntry {
        const entry: ChangeEntry = {
            id: generateUUID(), messageId, toolName, at: new Date().toISOString(), undone: false, ...change,
        };
        this.entries = [...this.entries, entry];
        this.emit();
        return entry;
    }

    async undo(entryId: string, port: AssistantStorePort): Promise<UndoResult> {
        const entry = this.entries.find((e) => e.id === entryId);
        if (!entry) return { ok: false, error: 'Unknown change' };
        if (entry.undone) return { ok: true };
        for (const op of entry.undoOps) {
            const r = await runUndoOp(op, port);
            if (!r.ok) return r;
        }
        this.entries = this.entries.map((e) => (e.id === entryId ? { ...e, undone: true } : e));
        this.emit();
        return { ok: true };
    }

    /** Undo everything one user message caused, newest first. */
    async undoMessage(messageId: string, port: AssistantStorePort): Promise<UndoResult> {
        const targets = this.forMessage(messageId).filter((e) => !e.undone).reverse();
        for (const entry of targets) {
            const r = await this.undo(entry.id, port);
            if (!r.ok) return r;
        }
        return { ok: true };
    }
}

async function runUndoOp(op: UndoOp, port: AssistantStorePort): Promise<UndoResult> {
    const wrap = (r: { success: boolean; error?: string }): UndoResult => (r.success ? { ok: true } : { ok: false, error: r.error ?? 'Undo failed' });
    switch (op.kind) {
        case 'restoreFields': {
            const updates: Record<string, unknown> = { ...op.fields };
            for (const key of op.clear) updates[key] = undefined;
            return wrap(await port.updateTask(op.taskId, updates as Partial<Task>));
        }
        case 'deleteTask': return wrap(await port.deleteTask(op.taskId));
        case 'restoreTask': return wrap(await port.restoreTask(op.taskId));
        case 'deleteProject': return wrap(await port.deleteProject(op.projectId));
        case 'restoreProject': return wrap(await port.restoreProject(op.projectId));
    }
}
