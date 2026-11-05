import { useCallback } from 'react';
import { generateUUID, useTaskStore, type ChecklistItem, type Task } from '@stride/core';

const readLive = (taskId: string): Task | undefined => useTaskStore.getState()._allTasks.find((t) => t.id === taskId);

export function useFocusSteps(taskId: string | undefined) {
    const updateTask = useTaskStore((state) => state.updateTask);
    const task = useTaskStore((state) => (taskId ? state._allTasks.find((t) => t.id === taskId) : undefined));
    const steps: ChecklistItem[] = task?.checklist ?? [];

    const mutate = useCallback((fn: (list: ChecklistItem[]) => ChecklistItem[]) => {
        const live = taskId ? readLive(taskId) : undefined;
        if (live) void updateTask(live.id, { checklist: fn(live.checklist ?? []) });
    }, [taskId, updateTask]);

    return {
        task,
        steps,
        toggle: (id: string) => mutate((list) => list.map((s) => (s.id === id ? { ...s, isCompleted: !s.isCompleted } : s))),
        rename: (id: string, title: string) => {
            const clean = title.trim();
            if (clean) mutate((list) => list.map((s) => (s.id === id ? { ...s, title: clean.slice(0, 200) } : s)));
        },
        remove: (id: string) => mutate((list) => list.filter((s) => s.id !== id)),
        add: (title: string) => {
            const clean = title.trim();
            if (clean) mutate((list) => [...list, { id: generateUUID(), title: clean.slice(0, 200), isCompleted: false }]);
        },
    };
}
