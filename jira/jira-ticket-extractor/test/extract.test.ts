import { describe, it, expect } from 'vitest';
import { fromApi, splitAcceptanceCriteria } from '../src/extract.js';
import type { RawIssue, AdfNode } from '../src/types.js';

const adfDoc = (text: string): AdfNode => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('splitAcceptanceCriteria', () => {
  it('slices an AC heading section out of the description', () => {
    const md = '# Overview\nStuff.\n\n## Acceptance Criteria\n- a\n- b\n\n## Notes\nx';
    const { description, acceptanceCriteria } = splitAcceptanceCriteria(md);
    expect(acceptanceCriteria).toBe('- a\n- b');
    expect(description).toContain('# Overview');
    expect(description).toContain('## Notes');
    expect(description).not.toContain('Acceptance Criteria');
  });

  it('returns null AC when no heading present', () => {
    const { description, acceptanceCriteria } = splitAcceptanceCriteria('just text');
    expect(acceptanceCriteria).toBeNull();
    expect(description).toBe('just text');
  });
});

describe('fromApi', () => {
  it('maps core fields and marks source api', () => {
    const raw: RawIssue = {
      key: 'PROJ-7',
      fields: {
        summary: 'Do the thing',
        description: adfDoc('A description.'),
        issuetype: { name: 'Story' },
        status: { name: 'In Progress' },
        priority: { name: 'High' },
        assignee: { displayName: 'Ada' },
        reporter: { displayName: 'Bob' },
        labels: ['x', 'y'],
        components: [{ name: 'api' }],
        issuelinks: [
          { type: { outward: 'blocks' }, outwardIssue: { key: 'PROJ-9', fields: { summary: 'Other' } } },
        ],
        attachment: [{ filename: 'log.txt' }],
      },
    };
    const t = fromApi(raw, 'cloud', 'https://acme.atlassian.net');
    expect(t.key).toBe('PROJ-7');
    expect(t.url).toBe('https://acme.atlassian.net/browse/PROJ-7');
    expect(t.summary).toBe('Do the thing');
    expect(t.description).toBe('A description.');
    expect(t.type).toBe('Story');
    expect(t.priority).toBe('High');
    expect(t.labels).toEqual(['x', 'y']);
    expect(t.components).toEqual(['api']);
    expect(t.links).toEqual([{ type: 'blocks', key: 'PROJ-9', summary: 'Other' }]);
    expect(t.attachments).toEqual(['log.txt']);
    expect(t.source).toBe('api');
  });

  it('pulls AC from a custom field when names map identifies one', () => {
    const raw: RawIssue = {
      key: 'PROJ-8',
      names: { customfield_10010: 'Acceptance Criteria' },
      fields: {
        summary: 'S',
        description: adfDoc('desc'),
        customfield_10010: adfDoc('- must work'),
      },
    };
    const t = fromApi(raw, 'cloud', 'https://acme.atlassian.net');
    expect(t.acceptanceCriteria).toBe('- must work');
  });

  it('falls back to a heading split when there is no AC custom field', () => {
    const description: AdfNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Overview' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body.' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Acceptance Criteria' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Must log in.' }] },
      ],
    };
    const raw: RawIssue = { key: 'PROJ-9', fields: { summary: 'S', description } };
    const t = fromApi(raw, 'cloud', 'https://acme.atlassian.net');
    expect(t.acceptanceCriteria).toBe('Must log in.');
    expect(t.description).toContain('Overview');
    expect(t.description).toContain('Body.');
    expect(t.description).not.toContain('Acceptance Criteria');
  });
});
