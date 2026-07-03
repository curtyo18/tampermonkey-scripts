import type { AdfNode, AdfMark } from './types.js';

function applyMarks(text: string, marks?: AdfMark[]): string {
  if (!marks) return text;
  let out = text;
  for (const m of marks) {
    switch (m.type) {
      case 'strong': out = `**${out}**`; break;
      case 'em': out = `*${out}*`; break;
      case 'code': out = `\`${out}\``; break;
      case 'strike': out = `~~${out}~~`; break;
      case 'link': {
        const href = (m.attrs?.href as string) ?? '';
        out = `[${out}](${href})`;
        break;
      }
      default: break; // unknown mark: leave text unstyled
    }
  }
  return out;
}

function renderInline(nodes: AdfNode[] | undefined): string {
  if (!nodes) return '';
  return nodes.map(renderNode).join('');
}

function renderList(node: AdfNode, ordered: boolean): string {
  const items = node.content ?? [];
  return items
    .map((li, i) => {
      const marker = ordered ? `${i + 1}. ` : '- ';
      const body = (li.content ?? []).map(renderNode).join('\n').trim();
      // Indent continuation lines to keep nested content under the marker.
      const indented = body.replace(/\n/g, `\n${' '.repeat(marker.length)}`);
      return `${marker}${indented}`;
    })
    .join('\n');
}

function renderNode(node: AdfNode): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map(renderNode).join('\n\n').trim();
    case 'paragraph':
      return renderInline(node.content);
    case 'text':
      return applyMarks(node.text ?? '', node.marks);
    case 'hardBreak':
      return '\n';
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `${'#'.repeat(level)} ${renderInline(node.content)}`;
    }
    case 'bulletList':
      return renderList(node, false);
    case 'orderedList':
      return renderList(node, true);
    case 'listItem':
      return (node.content ?? []).map(renderNode).join('\n');
    case 'blockquote':
      // Block container: render children as blocks (preserving paragraph breaks),
      // then prefix every line.
      return (node.content ?? [])
        .map(renderNode)
        .join('\n\n')
        .split('\n')
        .map(l => (l ? `> ${l}` : '>'))
        .join('\n');
    case 'codeBlock': {
      const lang = (node.attrs?.language as string) ?? '';
      const code = (node.content ?? []).map(c => c.text ?? '').join('');
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case 'rule':
      return '---';
    case 'panel':
      // Block container: keep paragraph/list breaks between children.
      return (node.content ?? []).map(renderNode).join('\n\n');
    case 'mention':
      return `@${(node.attrs?.text as string) ?? ''}`.replace(/^@@/, '@');
    case 'inlineCard':
      return (node.attrs?.url as string) ?? '';
    case 'table':
      return renderTable(node);
    default:
      // Unknown node: recurse so nested text survives.
      return node.content ? node.content.map(renderNode).join('') : (node.text ?? '');
  }
}

function renderCell(cell: AdfNode): string {
  // Cells hold block content (paragraphs); flatten to a single line and escape
  // pipes so a literal `|` in the text doesn't spawn a phantom column.
  return (cell.content ?? [])
    .map(renderNode)
    .join(' ')
    .replace(/\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function renderTable(node: AdfNode): string {
  const rows = (node.content ?? []).map(row => (row.content ?? []).map(renderCell));
  if (rows.length === 0) return '';
  // Markdown requires a header row + separator. ADF marks header cells as
  // `tableHeader`; if the first row is all headers use it, otherwise synthesize
  // a blank header so no data row is consumed into the header slot.
  const firstRowIsHeader = (node.content?.[0]?.content ?? []).every(
    c => c.type === 'tableHeader',
  );
  const width = Math.max(...rows.map(r => r.length));
  const pad = (r: string[]): string[] => [...r, ...Array(width - r.length).fill('')];
  const header = firstRowIsHeader ? pad(rows[0]) : Array(width).fill('');
  const body = firstRowIsHeader ? rows.slice(1) : rows;
  const sep = header.map(() => '---');
  const lines = [header, sep, ...body.map(pad)].map(cells => `| ${cells.join(' | ')} |`);
  return lines.join('\n');
}

export function adfToMarkdown(node: AdfNode): string {
  return renderNode(node).trim();
}
