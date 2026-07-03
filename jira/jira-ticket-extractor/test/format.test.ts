import { describe, it, expect } from 'vitest';
import { toMarkdown } from '../src/format.js';
import type { Ticket } from '../src/types.js';

const base: Ticket = {
  key: 'PROJ-1',
  url: 'https://acme.atlassian.net/browse/PROJ-1',
  summary: 'Add login',
  type: 'Story',
  status: 'To Do',
  priority: 'High',
  assignee: 'Ada',
  reporter: 'Bob',
  labels: ['auth'],
  components: ['api'],
  description: 'Users must log in.',
  acceptanceCriteria: '- valid creds pass\n- invalid fail',
  links: [{ type: 'blocks', key: 'PROJ-2', summary: 'Dashboard' }],
  attachments: ['mock.png'],
  source: 'api',
};

describe('toMarkdown', () => {
  it('includes the key and summary as a title', () => {
    expect(toMarkdown(base)).toContain('# [PROJ-1] Add login');
  });

  it('includes description and acceptance criteria sections', () => {
    const md = toMarkdown(base);
    expect(md).toContain('## Description\nUsers must log in.');
    expect(md).toContain('## Acceptance Criteria\n- valid creds pass');
  });

  it('omits the acceptance criteria section when null', () => {
    const md = toMarkdown({ ...base, acceptanceCriteria: null });
    expect(md).not.toContain('## Acceptance Criteria');
  });

  it('omits links section when there are none', () => {
    const md = toMarkdown({ ...base, links: [] });
    expect(md).not.toContain('## Links');
  });

  it('renders links as type + key + summary', () => {
    expect(toMarkdown(base)).toContain('- blocks PROJ-2 — Dashboard');
  });
});
