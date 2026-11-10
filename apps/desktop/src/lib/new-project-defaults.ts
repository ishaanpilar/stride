import { useTaskStore, type AppSettings, type Project } from '@stride/core';

type AddProject = ReturnType<typeof useTaskStore.getState>['addProject'];

/**
 * New projects on desktop start as "Next action only" (Project.isSequential). Core's default stays
 * parallel because the native hosts and their parity fixtures depend on it, so the desktop default is
 * applied here, once, around the shared store action: every create path (the Projects view, Capture,
 * AI Capture, the Assistant) goes through it. A caller that says otherwise, or a default the user set in
 * Settings > Projects (`gtd.defaultProjectFlowMode`), wins.
 */
export function applyNewProjectDefaults(
    props: Partial<Project> | undefined,
    settings: Pick<AppSettings, 'gtd'> | undefined,
): Partial<Project> | undefined {
    if (settings?.gtd?.defaultProjectFlowMode !== undefined) return props;
    if (props && Object.prototype.hasOwnProperty.call(props, 'isSequential')) return props;
    if (props?.perSectionFlow === true) return props;
    return { ...props, isSequential: true };
}

let installed = false;

export function installNewProjectDefaults(): void {
    if (installed) return;
    installed = true;
    const addProject: AddProject = useTaskStore.getState().addProject;
    useTaskStore.setState({
        addProject: (title, color, props) => addProject(
            title,
            color,
            applyNewProjectDefaults(props, useTaskStore.getState().settings),
        ),
    });
}

/** Test helper. */
export function resetNewProjectDefaultsForTests(): void {
    installed = false;
}
