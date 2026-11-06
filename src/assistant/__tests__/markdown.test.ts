import { parseInline, parseMarkdown } from '../markdown';

describe('markdown (safe subset)', () => {
  it('parses bold, italics and links', () => {
    expect(parseInline('a **b** *c* [d](/pricing)')).toEqual([
      { t: 'text', text: 'a ' },
      { t: 'text', text: 'b', bold: true },
      { t: 'text', text: ' ' },
      { t: 'text', text: 'c', italic: true },
      { t: 'text', text: ' ' },
      { t: 'link', href: '/pricing', children: [{ t: 'text', text: 'd' }] },
    ]);
  });

  it('keeps snake_case and unbalanced markers literal', () => {
    expect(parseInline('use snake_case_name and 2 * 3')).toEqual([
      { t: 'text', text: 'use snake_case_name and 2 * 3' },
    ]);
    expect(parseInline('**open')).toEqual([{ t: 'text', text: '**open' }]);
  });

  it('shows an image as its alt text only and inline code as plain text', () => {
    expect(parseInline('![logo](https://x/y.png) `x`')).toEqual([{ t: 'text', text: 'logo x' }]);
  });

  it('nested emphasis inside a link', () => {
    expect(parseInline('[**go**](/tools)')).toEqual([
      { t: 'link', href: '/tools', children: [{ t: 'text', text: 'go', bold: true }] },
    ]);
  });

  it('parses paragraphs, headings, bullet and numbered lists', () => {
    const b = parseMarkdown('# Title\n\nHello\nworld\n\n- one\n- two\n  more\n\n3. a\n4. b');
    expect(b).toEqual([
      { t: 'p', heading: true, inline: [{ t: 'text', text: 'Title', bold: true }] },
      { t: 'p', inline: [{ t: 'text', text: 'Hello world' }] },
      {
        t: 'ul',
        items: [[{ t: 'text', text: 'one' }], [{ t: 'text', text: 'two more' }]],
      },
      { t: 'ol', start: 3, items: [[{ t: 'text', text: 'a' }], [{ t: 'text', text: 'b' }]] },
    ]);
  });

  it('never produces HTML nodes: raw tags stay literal text', () => {
    const b = parseMarkdown('<script>alert(1)</script> <img src=x onerror=y>');
    expect(JSON.stringify(b)).toContain('<script>alert(1)</script>');
    expect(b.every((x) => x.t === 'p' || x.t === 'ul' || x.t === 'ol')).toBe(true);
  });

  it('survives hostile input without hanging', () => {
    const evil = `${'['.repeat(5000)}${'*'.repeat(5000)}${'_a'.repeat(3000)}`;
    expect(() => parseMarkdown(evil)).not.toThrow();
  });
});
