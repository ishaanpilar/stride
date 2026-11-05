import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from './assistant-markdown';
import { AssistantMarkdown } from './AssistantMarkdown';

describe('parseMarkdown', () => {
    it('parses headings, bullets and paragraphs', () => {
        const blocks = parseMarkdown('Checked 22 tasks.\n\n## Duplicates\n- one\n- two\n\n**Next**\n1. first');
        expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'heading', 'list', 'heading', 'list']);
        expect(blocks[2]).toMatchObject({ kind: 'list', ordered: false });
        expect(blocks[4]).toMatchObject({ kind: 'list', ordered: true });
    });

    it('does not treat apostrophes in prose as task chips', () => {
        const [p] = parseMarkdown("I don't think it's done");
        expect(p.kind === 'paragraph' && p.inline.every((n) => n.kind === 'text')).toBe(true);
    });
});

describe('AssistantMarkdown', () => {
    it('renders bold and quoted task names as chips', () => {
        const { getByTestId, getByText } = render(<AssistantMarkdown text={"## Clashes\n- **Tomorrow** has 'Call Ria' twice"} />);
        expect(getByText('Clashes').tagName).toBe('H3');
        expect(getByText('Tomorrow').tagName).toBe('STRONG');
        expect(getByTestId('assistant-task-chip').textContent).toBe('Call Ria');
    });

    it('never injects HTML from untrusted text', () => {
        const { container } = render(<AssistantMarkdown text={'<img src=x onerror=alert(1)> <script>x</script> **<b>hi</b>**'} />);
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('script')).toBeNull();
        expect(container.querySelector('b')).toBeNull();
        expect(container.textContent).toContain('<img');
    });
});

describe('fenced code blocks', () => {
    const source = 'Try this:\n```python\ndef add(a, b):\n    return a + b\n```\nThen `run` it.';

    it('parses a fence with its language and keeps indentation', () => {
        const blocks = parseMarkdown(source);
        expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'code', 'paragraph']);
        expect(blocks[1]).toEqual({ kind: 'code', lang: 'python', text: 'def add(a, b):\n    return a + b' });
    });

    it('treats an unclosed fence as code to the end and does not parse markdown inside it', () => {
        const blocks = parseMarkdown('```\n## not a heading\n- not a bullet');
        expect(blocks).toEqual([{ kind: 'code', text: '## not a heading\n- not a bullet' }]);
    });

    it('renders a monospace scrollable block with inline code and no injected HTML', () => {
        const { container, getByTestId } = render(<AssistantMarkdown text={`${source}\n\n\`\`\`html\n<script>alert(1)</script>\n\`\`\``} />);
        const blocks = container.querySelectorAll('[data-testid="assistant-code-block"]');
        expect(blocks).toHaveLength(2);
        const pre = blocks[0].querySelector('pre')!;
        expect(pre.className).toContain('overflow-x-auto');
        expect(pre.textContent).toBe('def add(a, b):\n    return a + b');
        expect(getByTestId('assistant-markdown').querySelector('p code')?.textContent).toBe('run');
        expect(container.querySelector('script')).toBeNull();
        expect(blocks[1].textContent).toContain('<script>alert(1)</script>');
    });

    it('copies the code with the copy button', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        render(<AssistantMarkdown text={source} />);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy code' })); });
        expect(writeText).toHaveBeenCalledWith('def add(a, b):\n    return a + b');
        expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    });
});
