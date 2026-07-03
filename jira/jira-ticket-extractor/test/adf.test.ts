import { describe, it, expect } from 'vitest';
import { adfToMarkdown } from '../src/adf.js';
import type { AdfNode } from '../src/types.js';

const doc = (...content: AdfNode[]): AdfNode => ({ type: 'doc', content });
const p = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content });
const t = (text: string, marks?: AdfNode['marks']): AdfNode => ({ type: 'text', text, marks });

describe('adfToMarkdown', () => {
  it('renders a plain paragraph', () => {
    expect(adfToMarkdown(doc(p(t('hello world'))))).toBe('hello world');
  });

  it('renders strong and em marks', () => {
    const node = doc(p(t('a', [{ type: 'strong' }]), t(' '), t('b', [{ type: 'em' }])));
    expect(adfToMarkdown(node)).toBe('**a** *b*');
  });

  it('renders a link mark', () => {
    const node = doc(p(t('site', [{ type: 'link', attrs: { href: 'https://x.io' } }])));
    expect(adfToMarkdown(node)).toBe('[site](https://x.io)');
  });

  it('renders headings at the right level', () => {
    const node = doc({ type: 'heading', attrs: { level: 2 }, content: [t('Title')] });
    expect(adfToMarkdown(node)).toBe('## Title');
  });

  it('renders a bullet list', () => {
    const li = (s: string): AdfNode => ({ type: 'listItem', content: [p(t(s))] });
    const node = doc({ type: 'bulletList', content: [li('one'), li('two')] });
    expect(adfToMarkdown(node)).toBe('- one\n- two');
  });

  it('renders an ordered list', () => {
    const li = (s: string): AdfNode => ({ type: 'listItem', content: [p(t(s))] });
    const node = doc({ type: 'orderedList', content: [li('a'), li('b')] });
    expect(adfToMarkdown(node)).toBe('1. a\n2. b');
  });

  it('renders a fenced code block', () => {
    const node = doc({
      type: 'codeBlock',
      attrs: { language: 'js' },
      content: [t('const x = 1;')],
    });
    expect(adfToMarkdown(node)).toBe('```js\nconst x = 1;\n```');
  });

  it('degrades unknown nodes to their text content', () => {
    const node = doc({ type: 'someFutureNode', content: [p(t('still readable'))] });
    expect(adfToMarkdown(node)).toBe('still readable');
  });

  it('renders a nested bullet list with indented children', () => {
    const li = (...content: AdfNode[]): AdfNode => ({ type: 'listItem', content });
    const inner: AdfNode = { type: 'bulletList', content: [li(p(t('child')))] };
    const outer: AdfNode = { type: 'bulletList', content: [li(p(t('parent')), inner)] };
    expect(adfToMarkdown(doc(outer))).toBe('- parent\n  - child');
  });

  it('preserves paragraph breaks inside a blockquote', () => {
    const node = doc({ type: 'blockquote', content: [p(t('one')), p(t('two'))] });
    expect(adfToMarkdown(node)).toBe('> one\n>\n> two');
  });

  it('preserves paragraph breaks inside a panel', () => {
    const node = doc({ type: 'panel', content: [p(t('note one')), p(t('note two'))] });
    expect(adfToMarkdown(node)).toBe('note one\n\nnote two');
  });

  it('renders a table with a header row and escapes pipes in cells', () => {
    const cell = (text: string, header = false): AdfNode => ({
      type: header ? 'tableHeader' : 'tableCell',
      content: [p(t(text))],
    });
    const rows: AdfNode[] = [
      { type: 'tableRow', content: [cell('H1', true), cell('H2', true)] },
      { type: 'tableRow', content: [cell('a | b'), cell('c')] },
    ];
    const node = doc({ type: 'table', content: rows });
    expect(adfToMarkdown(node)).toBe('| H1 | H2 |\n| --- | --- |\n| a \\| b | c |');
  });

  it('synthesizes a blank header when the table has no header row', () => {
    const cell = (text: string): AdfNode => ({ type: 'tableCell', content: [p(t(text))] });
    const rows: AdfNode[] = [
      { type: 'tableRow', content: [cell('r1a'), cell('r1b')] },
      { type: 'tableRow', content: [cell('r2a'), cell('r2b')] },
    ];
    const node = doc({ type: 'table', content: rows });
    // First data row must NOT be swallowed into the header slot.
    expect(adfToMarkdown(node)).toBe('|  |  |\n| --- | --- |\n| r1a | r1b |\n| r2a | r2b |');
  });
});
