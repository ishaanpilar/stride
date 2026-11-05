import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindSweepProposal } from '@stride/core';
import { DesktopOnboardingFlow } from './DesktopOnboardingFlow';
import type { OnboardingServices } from './onboarding/onboarding-services';
import { LanguageProvider } from '../contexts/language-context';

const item = (key: string, title: string, kind: 'inbox' | 'next' = 'inbox') => ({ key, title, kind } as MindSweepProposal['items'][number]);
const fallbackProposal = (): MindSweepProposal => ({
    projects: [], summary: '', source: 'fallback', fallbackReason: 'disabled',
    items: [item('a', 'Call dentist'), item('b', 'Buy milk')],
});

const makeServices = (overrides: Partial<OnboardingServices> = {}): OnboardingServices => ({
    testKey: vi.fn(async () => ({ ok: true as const })),
    saveAi: vi.fn(async () => undefined),
    generateProposal: vi.fn(async () => fallbackProposal()),
    applyProposal: vi.fn(async (p) => ({ projectIds: [], taskIds: p.items.map((i: { key: string }) => i.key), failed: [] })),
    isAiReady: vi.fn(async () => false),
    seedGuide: vi.fn(async () => 'guide-1'),
    getLaunchAtLogin: vi.fn(async () => false),
    setLaunchAtLogin: vi.fn(async (enabled: boolean) => enabled),
    enableCalendar: vi.fn(async () => 'enabled' as const),
    disableCalendar: vi.fn(async () => undefined),
    ...overrides,
});

const setup = (services: OnboardingServices, extra: Record<string, unknown> = {}) => {
    const props = { onSkip: vi.fn(), onFinish: vi.fn(), onOpenLink: vi.fn(), ...extra };
    render(
        <LanguageProvider>
            <DesktopOnboardingFlow isOpen services={services} {...props} />
        </LanguageProvider>,
    );
    return props;
};
const click = async (name: RegExp | string) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };
const toStep = async (n: number) => {
    await click(/get started/i);
    if (n >= 2) await click(/skip for now/i);
    if (n >= 3) await click(/^skip$/i);
};

describe('DesktopOnboardingFlow', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders nothing when closed', () => {
        render(<LanguageProvider><DesktopOnboardingFlow isOpen={false} onSkip={vi.fn()} onFinish={vi.fn()} /></LanguageProvider>);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('welcome step shows the idea, tribute and step 1 of 5', () => {
        setup(makeServices());
        expect(screen.getByRole('heading', { name: /welcome to stride/i })).toBeInTheDocument();
        expect(screen.getByText(/Built on the ideas of Getting Things Done by David Allen/)).toBeInTheDocument();
        expect(screen.getByText('Mind like water.')).toBeInTheDocument();
        expect(screen.getAllByText('Step 1 of 5').length).toBeGreaterThan(0);
    });

    it('Skip setup is available on every step and calls onSkip', async () => {
        const props = setup(makeServices());
        fireEvent.click(screen.getByRole('button', { name: /skip setup/i }));
        expect(props.onSkip).toHaveBeenCalledTimes(1);
        await toStep(2);
        fireEvent.click(screen.getByRole('button', { name: /skip setup/i }));
        expect(props.onSkip).toHaveBeenCalledTimes(2);
    });

    it('Back and Next move between steps', async () => {
        setup(makeServices());
        await click(/get started/i);
        expect(screen.getByRole('heading', { name: /connect the assistant/i })).toBeInTheDocument();
        await click(/^back$/i);
        expect(screen.getByRole('heading', { name: /welcome to stride/i })).toBeInTheDocument();
    });

    describe('AI step', () => {
        it('skipping leaves AI off and makes the sweep manual', async () => {
            const services = makeServices();
            setup(services);
            await click(/get started/i);
            await click(/skip for now/i);
            expect(services.saveAi).not.toHaveBeenCalled();
            expect(screen.getByText(/each line becomes an inbox task/i)).toBeInTheDocument();
        });

        it('tests the key through the injected provider and shows success', async () => {
            const services = makeServices();
            setup(services);
            await click(/get started/i);
            fireEvent.change(screen.getByLabelText('API key'), { target: { value: ' sk-test ' } });
            expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'password');
            await click(/test key/i);
            expect(services.testKey).toHaveBeenCalledWith('deepseek', 'sk-test', 'en');
            expect(screen.getByText('Your key works.')).toBeInTheDocument();
        });

        it('shows a plain-language error for a bad key and does not advance', async () => {
            const services = makeServices({ testKey: vi.fn(async () => ({ ok: false as const, reason: 'badKey' as const })) });
            setup(services);
            await click(/get started/i);
            fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'nope' } });
            await click(/test key/i);
            expect(screen.getByText(/key was not accepted/i)).toBeInTheDocument();
            await click(/^next$/i);
            expect(services.saveAi).not.toHaveBeenCalled();
            expect(screen.getByRole('heading', { name: /connect the assistant/i })).toBeInTheDocument();
        });

        it('shows a network error', async () => {
            const services = makeServices({ testKey: vi.fn(async () => ({ ok: false as const, reason: 'network' as const })) });
            setup(services);
            await click(/get started/i);
            fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'k' } });
            await click(/test key/i);
            expect(screen.getByText(/could not reach deepseek/i)).toBeInTheDocument();
        });

        it('saves a working key with the chosen provider and advances', async () => {
            const services = makeServices();
            setup(services);
            await click(/get started/i);
            await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Claude' })); });
            fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-ant' } });
            await click(/^next$/i);
            expect(services.saveAi).toHaveBeenCalledWith('claude', 'sk-ant');
            expect(screen.getByRole('heading', { name: /first mind sweep/i })).toBeInTheDocument();
        });

        it('opens the get-a-key link through onOpenLink', async () => {
            const props = setup(makeServices());
            await click(/get started/i);
            await click(/get a key/i);
            expect(props.onOpenLink).toHaveBeenCalledWith('https://platform.deepseek.com/api_keys');
        });
    });

    describe('mind sweep', () => {
        it('without AI each line becomes an Inbox task in the review list', async () => {
            const services = makeServices();
            setup(services);
            await toStep(2);
            fireEvent.change(screen.getByLabelText(/what's on your mind/i), { target: { value: 'Call dentist\nBuy milk' } });
            await click(/^next$/i);
            await waitFor(() => expect(screen.getByDisplayValue('Call dentist')).toBeInTheDocument());
            expect(screen.getByText(/ai will sort|assistant will sort them/i)).toBeInTheDocument();
            fireEvent.click(screen.getByLabelText(/Include: Buy milk/));
            await click(/add to stride/i);
            expect(services.applyProposal).toHaveBeenCalledTimes(1);
            const arg = (services.applyProposal as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(arg.items.map((i: { title: string }) => i.title)).toEqual(['Call dentist']);
            expect(screen.getByRole('heading', { name: /make it yours/i })).toBeInTheDocument();
        });

        it('with AI ready uses the mocked engine and shows its summary', async () => {
            const proposal: MindSweepProposal = {
                projects: [], summary: 'Two things and a project.', source: 'ai',
                items: [item('x', 'Draft report', 'next')],
            };
            const services = makeServices({ isAiReady: vi.fn(async () => true), generateProposal: vi.fn(async () => proposal) });
            setup(services);
            await act(async () => { await Promise.resolve(); });
            await toStep(2);
            expect(screen.queryByText(/each line becomes/i)).not.toBeInTheDocument();
            fireEvent.change(screen.getByLabelText(/what's on your mind/i), { target: { value: 'report' } });
            await click(/^next$/i);
            await waitFor(() => expect(screen.getByText('Two things and a project.')).toBeInTheDocument());
            expect(screen.getByDisplayValue('Draft report')).toBeInTheDocument();
        });

        it('Skip adds nothing', async () => {
            const services = makeServices();
            setup(services);
            await toStep(3);
            expect(services.applyProposal).not.toHaveBeenCalled();
            expect(screen.getByRole('heading', { name: /make it yours/i })).toBeInTheDocument();
        });

        it('can also seed the guide project', async () => {
            const services = makeServices();
            setup(services);
            await toStep(2);
            fireEvent.change(screen.getByLabelText(/what's on your mind/i), { target: { value: 'x' } });
            await click(/^next$/i);
            await waitFor(() => screen.getByLabelText(/also add a short guide project/i));
            fireEvent.click(screen.getByLabelText(/also add a short guide project/i));
            await click(/add to stride/i);
            expect(services.seedGuide).toHaveBeenCalledTimes(1);
        });
    });

    describe('customise step', () => {
        it('toggles call login and calendar commands and show status', async () => {
            const services = makeServices();
            setup(services);
            await toStep(3);
            await click(/^skip$/i).catch(() => undefined);
            await act(async () => { fireEvent.click(screen.getByRole('switch', { name: /open stride at login/i })); });
            expect(services.setLaunchAtLogin).toHaveBeenCalledWith(true);
            await act(async () => { fireEvent.click(screen.getByRole('switch', { name: /sync tasks to your calendar/i })); });
            expect(services.enableCalendar).toHaveBeenCalled();
            expect(screen.getByText('Calendar sync is on.')).toBeInTheDocument();
            await act(async () => { fireEvent.click(screen.getByRole('switch', { name: /sync tasks to your calendar/i })); });
            expect(services.disableCalendar).toHaveBeenCalled();
        });

        it('explains a denied calendar permission', async () => {
            const services = makeServices({ enableCalendar: vi.fn(async () => 'denied' as const) });
            setup(services);
            await toStep(3);
            await act(async () => { fireEvent.click(screen.getByRole('switch', { name: /sync tasks to your calendar/i })); });
            expect(screen.getByText(/calendar access was not allowed/i)).toBeInTheDocument();
            expect(screen.getByRole('switch', { name: /sync tasks/i })).toHaveAttribute('aria-checked', 'false');
        });
    });

    describe('done step', () => {
        const toDone = async () => { await toStep(3); await click(/^next$/i); };

        it('opens Focus when nothing was added', async () => {
            const props = setup(makeServices());
            await toDone();
            expect(screen.getByText('⌘⇧K')).toBeInTheDocument();
            expect(screen.getByText('⌘⇧J')).toBeInTheDocument();
            await click(/open stride/i);
            expect(props.onFinish).toHaveBeenCalledWith('focus');
        });

        it('opens Inbox when tasks were added', async () => {
            const props = setup(makeServices());
            await toStep(2);
            fireEvent.change(screen.getByLabelText(/what's on your mind/i), { target: { value: 'a\nb' } });
            await click(/^next$/i);
            await waitFor(() => screen.getByRole('button', { name: /add to stride/i }));
            await click(/add to stride/i);
            await click(/^next$/i);
            await click(/open stride/i);
            expect(props.onFinish).toHaveBeenCalledWith('inbox');
        });
    });

    describe('Escape handling', () => {
        it('asks before leaving when there is unsaved typing', async () => {
            const props = setup(makeServices());
            await toStep(1);
            fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'secret' } });
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
            expect(props.onSkip).not.toHaveBeenCalled();
            expect(screen.getByText(/leave setup\?/i)).toBeInTheDocument();
            await click(/keep going/i);
            expect(screen.queryByText(/leave setup\?/i)).not.toBeInTheDocument();
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
            await click(/^leave setup$/i);
            expect(props.onSkip).toHaveBeenCalledTimes(1);
        });
    });

    it('Enter triggers the primary action', async () => {
        setup(makeServices());
        await act(async () => { fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' }); });
        expect(screen.getByRole('heading', { name: /connect the assistant/i })).toBeInTheDocument();
    });
});
