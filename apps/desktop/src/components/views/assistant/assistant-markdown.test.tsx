import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
