import type { Ticket } from './types.js';

const VERSION = '0.1.0';

function metaLine(pairs: [string, string | null][]): string {
  return pairs
    .filter(([, v]) => v && v.length > 0)
    .map(([k, v]) => `**${k}:** ${v}`)
    .join('   ');
}

export function toMarkdown(t: Ticket): string {
  const parts: string[] = [];
  parts.push(`# [${t.key}] ${t.summary}`.trim());

  const line1 = metaLine([
    ['Type', t.type],
    ['Status', t.status],
    ['Priority', t.priority],
  ]);
  const line2 = metaLine([
    ['Labels', t.labels.length ? t.labels.join(', ') : null],
    ['Components', t.components.length ? t.components.join(', ') : null],
  ]);
  const metaBlock = [line1, line2, `**URL:** ${t.url}`]
    .filter(Boolean)
    .map(l => `- ${l}`)
    .join('\n');
  parts.push(metaBlock);

  if (t.description) parts.push(`## Description\n${t.description}`);
  if (t.acceptanceCriteria) parts.push(`## Acceptance Criteria\n${t.acceptanceCriteria}`);

  if (t.links.length) {
    const links = t.links.map(l => `- ${l.type} ${l.key} — ${l.summary}`.trim()).join('\n');
    parts.push(`## Links\n${links}`);
  }
  if (t.attachments.length) {
    parts.push(`## Attachments\n${t.attachments.map(a => `- ${a}`).join('\n')}`);
  }

  parts.push(`<!-- extracted via ${t.source} by jira-ticket-extractor v${VERSION} -->`);
  return parts.join('\n\n');
}
