import type { useTaskStore } from '../../store';
import type { AssistantStorePort } from './types';
import type { RoutingCorrection } from '../routing-corrections';

type StoreState = ReturnType<typeof useTaskStore.getState>;

/**
 * Tools run through the same store actions the UI uses, so sync, undo and the UI stay consistent.
 * Platform-neutral: each app passes its own state getter and (optional) routing-correction log.
 */
export function createAssistantStorePort(
    getState: () => StoreState,
    getRoutingCorrections?: () => RoutingCorrection[],
): AssistantStorePort {
    const st = getState;
    return {
        getSnapshot: () => {
            const s = st();
            return { tasks: s.tasks, projects: s.projects, areas: s.areas, people: s.people };
        },
        addTask: (title, props) => st().addTask(title, props),
        updateTask: (id, updates) => st().updateTask(id, updates),
        completeTask: (id) => st().moveTask(id, 'done'),
        deleteTask: (id) => st().deleteTask(id),
        restoreTask: (id) => st().restoreTask(id),
        addProject: (title, color, props) => st().addProject(title, color, props),
        deleteProject: (id) => st().deleteProject(id),
        restoreProject: (id) => st().restoreProject(id),
        updateProject: (id, updates) => st().updateProject(id, updates),
        addArea: (name, props) => st().addArea(name, props),
        updateArea: (id, updates) => st().updateArea(id, updates),
        deleteArea: (id) => st().deleteArea(id),
        restoreArea: (id) => st().restoreArea(id),
        addPerson: (name) => st().addPerson(name),
        deletePerson: (id) => st().deletePerson(id),
        reorderProjectTasks: (projectId, orderedIds) => st().reorderProjectTasks(projectId, orderedIds),
        ...(getRoutingCorrections ? { getRoutingCorrections } : {}),
    };
}
