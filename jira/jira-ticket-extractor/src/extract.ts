import type { JiraFlavor, RawIssue, Ticket, TicketLink, AdfNode } from './types.js';
import { adfToMarkdown } from './adf.js';
import { discoverAcFieldId } from './api.js';

// Convert a description-like field value (ADF object, or a string) to Markdown.
function fieldToMarkdown(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && (value as AdfNode).type === 'doc') {
    return adfToMarkdown(value as AdfNode);
  }
  return '';
}

export function splitAcceptanceCriteria(md: string): {
  description: string;
  acceptanceCriteria: string | null;
} {
  const lines = md.split('\n');
  const startIdx = lines.findIndex(l => /^#{1,6}\s*acceptance\s*criteria\b/i.test(l));
  if (startIdx === -1) return { description: md.trim(), acceptanceCriteria: null };

  const headingLevel = (lines[startIdx].match(/^#+/)?.[0].length) ?? 1;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= headingLevel) {
      endIdx = i;
      break;
    }
  }
  const acceptanceCriteria = lines
    .slice(startIdx + 1, endIdx)
    .join('\n')
    .trim();
  const description = [...lines.slice(0, startIdx), ...lines.slice(endIdx)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { description, acceptanceCriteria: acceptanceCriteria || null };
}

function mapLinks(raw: RawIssue): TicketLink[] {
  const out: TicketLink[] = [];
  for (const l of raw.fields.issuelinks ?? []) {
    if (l.outwardIssue) {
      out.push({
        type: l.type?.outward ?? 'relates to',
        key: l.outwardIssue.key ?? '',
        summary: l.outwardIssue.fields?.summary ?? '',
      });
    }
    if (l.inwardIssue) {
      out.push({
        type: l.type?.inward ?? 'relates to',
        key: l.inwardIssue.key ?? '',
        summary: l.inwardIssue.fields?.summary ?? '',
      });
    }
  }
  if (raw.fields.parent?.key) {
    out.push({
      type: 'parent',
      key: raw.fields.parent.key,
      summary: raw.fields.parent.fields?.summary ?? '',
    });
  }
  for (const st of raw.fields.subtasks ?? []) {
    if (st.key) out.push({ type: 'subtask', key: st.key, summary: st.fields?.summary ?? '' });
  }
  return out;
}

export function fromApi(raw: RawIssue, _flavor: JiraFlavor, baseUrl: string): Ticket {
  const f = raw.fields;
  const rawDescription = fieldToMarkdown(f.description);

  // AC precedence: dedicated custom field, else heading split of the description.
  let description = rawDescription;
  let acceptanceCriteria: string | null = null;

  const acFieldId = raw.names ? discoverAcFieldId(raw.names) : null;
  if (acFieldId && f[acFieldId] != null) {
    const acMd = fieldToMarkdown(f[acFieldId]);
    if (acMd) acceptanceCriteria = acMd;
  }
  if (!acceptanceCriteria) {
    const split = splitAcceptanceCriteria(rawDescription);
    description = split.description;
    acceptanceCriteria = split.acceptanceCriteria;
  }

  return {
    key: raw.key,
    url: `${baseUrl}/browse/${raw.key}`,
    summary: f.summary ?? '',
    type: f.issuetype?.name ?? '',
    status: f.status?.name ?? '',
    priority: f.priority?.name ?? null,
    assignee: f.assignee?.displayName ?? null,
    reporter: f.reporter?.displayName ?? null,
    labels: f.labels ?? [],
    components: (f.components ?? []).map(c => c.name ?? '').filter(Boolean),
    description,
    acceptanceCriteria,
    links: mapLinks(raw),
    attachments: (f.attachment ?? []).map(a => a.filename ?? '').filter(Boolean),
    source: 'api',
  };
}
