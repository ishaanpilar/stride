import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore, type Project } from '@stride/core';

import { ProjectDetailsHeader } from './ProjectDetailsHeader';
import { ProjectsSidebar } from './ProjectsSidebar';
import { ProjectTitleLengthHint, useProjectTitleShortener } from './ShortenProjectTitleDialog';
import { useUiStore } from '../../../store/ui-store';

const shortenProjectTitle = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/project-title-service', () => ({ shortenProjectTitle }));

const LONG = 'Packaging requirement for Frackly Works including box inserts, printed manuals and the retail sleeve for Printstick v2';
const HINT = 'Shorter names are easier to scan: put details in the project notes';
const t = (key: string) => ({ 'projects.title': 'Project title', 'taskEdit.moreOptions': 'More options' } as Record<string, string>)[key] ?? key;

function buildProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 'project-1',
        title: LONG,
        status: 'active',
        color: '#3b82f6',
        order: 0,
        tagIds: [],
        createdAt: '2026-03-30T09:00:00',
        updatedAt: '2026-03-30T09:00:00',
        ...overrides,
    };
}

const initialTaskState = useTaskStore.getState();
const initialUiState = useUiStore.getState();
const setAiEnabled = (enabled: boolean) => act(() => {
    useTaskStore.setState((state) => ({ ...state, settings: { ...state.settings, ai: { ...(state.settings.ai ?? {}), enabled } } }));
});

beforeEach(() => {
    shortenProjectTitle.mockReset();
});
afterEach(() => {
    act(() => {
        useTaskStore.setState(initialTaskState, true);
        useUiStore.setState(initialUiState, true);
    });
});

describe('ProjectTitleLengthHint', () => {
    it('appears only once a title passes 40 characters and never blocks', () => {
        const { rerender } = render(<ProjectTitleLengthHint title={'a'.repeat(40)} t={t} />);
        expect(screen.queryByText(HINT)).not.toBeInTheDocument();
        rerender(<ProjectTitleLengthHint title={'a'.repeat(41)} t={t} />);
        expect(screen.getByText(HINT)).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('offers Shorten with AI (sparkles) when AI is on, and the heuristic label when off', () => {
        const onShorten = vi.fn();
        const { rerender } = render(<ProjectTitleLengthHint title={LONG} t={t} onShorten={onShorten} aiEnabled />);
        fireEvent.click(screen.getByRole('button', { name: 'Shorten with AI' }));
        expect(onShorten).toHaveBeenCalledOnce();
        rerender(<ProjectTitleLengthHint title={LONG} t={t} onShorten={onShorten} aiEnabled={false} />);
        expect(screen.queryByRole('button', { name: 'Shorten with AI' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Shorten title' })).toBeInTheDocument();
    });
});

describe('ProjectDetailsHeader shorten', () => {
    const renderHeader = (project: Project, props: Partial<Parameters<typeof ProjectDetailsHeader>[0]> = {}) => render(
        <ProjectDetailsHeader
            project={project} projectColor="#2563eb" isSequential={false}
            editTitle={project.title} onEditTitleChange={vi.fn()} onCommitTitle={vi.fn()} onResetTitle={vi.fn()}
            detailsExpanded={false} onToggleDetails={vi.fn()} onDuplicate={vi.fn()}
            onArchive={vi.fn()} onReactivate={vi.fn()} onDelete={vi.fn()} t={t}
            {...props}
        />,
    );

    it('shows the hint and a Shorten menu item for a long title', () => {
        const onShortenTitle = vi.fn();
        renderHeader(buildProject(), { onShortenTitle, shortenWithAi: true });
        expect(screen.getByText(HINT)).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Project title' })).toHaveAttribute('aria-describedby', 'project-title-hint-project-1');
        fireEvent.click(screen.getByRole('button', { name: /^More options: / }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Shorten with AI' }));
        expect(onShortenTitle).toHaveBeenCalledOnce();
    });

    it('stays quiet for short titles and read-only projects', () => {
        const onShortenTitle = vi.fn();
        const { unmount } = renderHeader(buildProject({ title: 'Launch site' }), { onShortenTitle });
        expect(screen.queryByText(HINT)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^More options: / }));
        expect(screen.queryByRole('menuitem', { name: 'Shorten title' })).not.toBeInTheDocument();
        unmount();
        renderHeader(buildProject({ status: 'archived' }), { onShortenTitle, readOnly: true });
        expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    });
});

function ShortenerHarness({ project, update }: { project: Project; update: (id: string, updates: Partial<Project>) => Promise<void> }) {
    const shortener = useProjectTitleShortener({ project, t, updateProject: update });
    return <><button type="button" onClick={shortener.open}>open shortener</button>{shortener.dialog}</>;
}

describe('useProjectTitleShortener', () => {
    it('suggests a title, moves the original into the notes on confirm, and undoes both', async () => {
        setAiEnabled(true);
        shortenProjectTitle.mockResolvedValue({ title: 'Printstick v2 packaging', source: 'ai' });
        const update = vi.fn(async () => {});
        render(<ShortenerHarness project={buildProject({ supportNotes: 'Akash handles it' })} update={update} />);
        fireEvent.click(screen.getByRole('button', { name: 'open shortener' }));
        expect(screen.getByRole('heading', { name: 'Shorten with AI' })).toBeInTheDocument();
        const input = await screen.findByDisplayValue('Printstick v2 packaging');
        expect(shortenProjectTitle).toHaveBeenCalledWith(LONG, 'Akash handles it', expect.any(String));
        expect(screen.getByRole('checkbox', { name: 'Move the full title into the project notes' })).toBeChecked();
        fireEvent.change(input, { target: { value: 'Printstick packaging' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(update).toHaveBeenCalledWith('project-1', {
            title: 'Printstick packaging',
            supportNotes: `${LONG}\n\nAkash handles it`,
        }));
        expect(screen.queryByTestId('shorten-project-title-dialog')).not.toBeInTheDocument();
        const toast = await waitFor(() => {
            const found = useUiStore.getState().toasts.find((entry) => entry.message === 'Title shortened');
            expect(found?.action).toBeDefined();
            return found!;
        });
        act(() => toast.action!.onClick());
        await waitFor(() => expect(update).toHaveBeenLastCalledWith('project-1', { title: LONG, supportNotes: 'Akash handles it' }));
    });

    it('keeps the notes untouched when the user unticks the move, and cancels cleanly', async () => {
        setAiEnabled(false);
        shortenProjectTitle.mockResolvedValue({ title: 'Packaging requirement for Frackly Works', source: 'fallback' });
        const update = vi.fn(async () => {});
        render(<ShortenerHarness project={buildProject()} update={update} />);
        fireEvent.click(screen.getByRole('button', { name: 'open shortener' }));
        expect(screen.getByRole('heading', { name: 'Shorten title' })).toBeInTheDocument();
        await screen.findByDisplayValue('Packaging requirement for Frackly Works');
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(update).toHaveBeenCalledWith('project-1', { title: 'Packaging requirement for Frackly Works' }));

        fireEvent.click(screen.getByRole('button', { name: 'open shortener' }));
        await screen.findByDisplayValue('Packaging requirement for Frackly Works');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByTestId('shorten-project-title-dialog')).not.toBeInTheDocument();
        expect(update).toHaveBeenCalledTimes(1);
    });
});

describe('ProjectsSidebar long titles', () => {
    it('truncates long project and area names on one line with the full title as a tooltip, without horizontal scroll', () => {
        const project = buildProject();
        const areaName = 'Frackly Works and every other client we have ever worked with in the last decade';
        const { container } = render(
            <ProjectsSidebar
                t={t}
                selectedTag="__all__"
                noAreaId="__no_area__"
                allTagsId="__all__"
                noTagsId="__none__"
                tagOptions={{ list: [], hasNoTags: true }}
                isCreating
                isCreatingProject={false}
                newProjectTitle={LONG}
                newProjectAreaId=""
                areaOptions={[]}
                onStartCreate={vi.fn()}
                onCancelCreate={vi.fn()}
                onCreateProject={vi.fn()}
                onChangeNewProjectTitle={vi.fn()}
                onChangeNewProjectAreaId={vi.fn()}
                onSelectTag={vi.fn()}
                groupedActiveProjects={[['area-1', [project]]]}
                groupedDeferredProjects={[]}
                groupedArchivedProjects={[]}
                areaById={new Map([['area-1', { id: 'area-1', name: areaName, order: 0, createdAt: '', updatedAt: '' }]])}
                collapsedAreas={{}}
                onToggleAreaCollapse={vi.fn()}
                showDeferredProjects={false}
                onToggleDeferredProjects={vi.fn()}
                showArchivedProjects={false}
                onToggleArchivedProjects={vi.fn()}
                selectedProjectId={null}
                onSelectProject={vi.fn()}
                getProjectColor={(entry) => entry.color}
                projectTaskSummaryById={new Map()}
                projects={[project]}
                focusedProjectCount={0}
                toggleProjectFocus={vi.fn()}
                onDuplicateProject={vi.fn()}
                draggingSection={null}
            />,
        );
        const title = container.querySelector('[data-project-title]')!;
        expect(title).toHaveAttribute('title', LONG);
        expect(title).toHaveClass('truncate', 'min-w-0', 'flex-1');
        expect(title.parentElement).toHaveClass('min-w-0');
        const count = title.parentElement!.lastElementChild!;
        expect(count).toHaveClass('flex-none');
        const area = screen.getByTitle(areaName);
        expect(area).toHaveClass('truncate');
        expect(area.parentElement).toHaveClass('min-w-0');
        const scrollers = Array.from(container.querySelectorAll('[class*="overflow-y-auto"]'));
        for (const scroller of scrollers) expect(scroller).toHaveClass('overflow-x-hidden');
        expect(container.innerHTML).not.toMatch(/overflow-x-(auto|scroll)/);
        // Create form: soft hint, not a block.
        expect(screen.getByText(HINT)).toBeInTheDocument();
        expect(screen.getByLabelText('projects.projectName')).toHaveAttribute('aria-describedby', 'new-project-title-hint');
    });
});
