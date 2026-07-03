import type { Ticket } from './types.js';
import { getIssueKey, getBaseUrl } from './detect.js';
import { splitAcceptanceCriteria } from './extract.js';

function text(sel: string): string {
  return document.querySelector(sel)?.textContent?.trim() ?? '';
}

// Convert a rendered description container to rough Markdown (headings, lists, text).
function domToMarkdown(root: Element | null): string {
  if (!root) return '';
  const out: string[] = [];
  root.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const s = node.textContent?.trim();
      if (s) out.push(s);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName.toLowerCase();
    const content = node.textContent?.trim() ?? '';
    if (!content) return;
    if (/^h[1-6]$/.test(tag)) {
      out.push(`${'#'.repeat(Number(tag[1]))} ${content}`);
    } else if (tag === 'ul' || tag === 'ol') {
      node.querySelectorAll('li').forEach((li, i) => {
        const marker = tag === 'ol' ? `${i + 1}.` : '-';
        out.push(`${marker} ${li.textContent?.trim() ?? ''}`);
      });
    } else if (tag === 'pre') {
      out.push('```\n' + content + '\n```');
    } else {
      out.push(content);
    }
  });
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function fromDom(): Ticket | null {
  const key = getIssueKey();
  if (!key) return null;

  const summary =
    text('[data-testid="issue.views.issue-base.foundation.summary.heading"]') ||
    text('#summary-val') ||
    text('h1');

  const descRoot =
    document.querySelector('[data-testid="issue.views.field.rich-text.description"]') ||
    document.querySelector('#description-val .user-content-block') ||
    document.querySelector('#descriptionmodule .mod-content');

  const rawDescription = domToMarkdown(descRoot);
  const { description, acceptanceCriteria } = splitAcceptanceCriteria(rawDescription);

  return {
    key,
    url: `${getBaseUrl()}/browse/${key}`,
    summary,
    type: text('#type-val') || text('[data-testid$="issue-type.name"]'),
    status: text('[data-testid$="status-field.status-view"]') || text('#status-val'),
    priority: text('#priority-val') || null,
    assignee: text('[data-testid$="assignee.assignee"]') || text('#assignee-val') || null,
    reporter: text('#reporter-val') || null,
    labels: Array.from(document.querySelectorAll('#labels-val .lozenge, [data-testid$="labels.label"]'))
      .map(el => el.textContent?.trim() ?? '')
      .filter(Boolean),
    components: Array.from(document.querySelectorAll('#components-val .item'))
      .map(el => el.textContent?.trim() ?? '')
      .filter(Boolean),
    description,
    acceptanceCriteria,
    links: [],
    attachments: [],
    source: 'dom',
  };
}
