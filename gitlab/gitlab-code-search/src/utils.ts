import type { SearchResult } from './types.js';

export function resolveApiEndpoint(pathname: string, projectId: number | null): string {
  if (/^\/-\/search/.test(pathname)) return '/api/v4/search';

  // .+? intentionally matches slashes — GitLab nested groups use /groups/parent/child/-/search
  const groupMatch = pathname.match(/^\/groups\/(.+?)\/-\/search/);
  if (groupMatch) return `/api/v4/groups/${groupMatch[1]}/search`;

  if (projectId !== null) return `/api/v4/projects/${projectId}/search`;

  return '/api/v4/search';
}

/** Parse a comma/space-separated extension string into normalised extension tokens. */
export function parseExtensions(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map(e => e.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean);
}

/**
 * Client-side filter applied to already-fetched results.
 * Extension match is exact suffix; text match is a case-insensitive literal
 * substring across path, filename, and code snippet — finds "hello-world"
 * even when GitLab's tokeniser split it at the hyphen.
 */
export function filterResults(
  results: SearchResult[],
  textFilter: string,
  extensions: string[],
): SearchResult[] {
  let out = results;

  if (extensions.length > 0) {
    out = out.filter(r => {
      const ext = r.filename.split('.').pop()?.toLowerCase() ?? '';
      return extensions.includes(ext);
    });
  }

  if (textFilter.trim()) {
    const q = textFilter.toLowerCase();
    out = out.filter(r =>
      r.path.toLowerCase().includes(q) ||
      r.filename.toLowerCase().includes(q) ||
      (r.data?.toLowerCase().includes(q) ?? false),
    );
  }

  return out;
}

export function extractRepoPaths(results: SearchResult[]): string[] {
  const seen = new Set<string>();
  for (const r of results) {
    if (r.project_path) seen.add(r.project_path);
  }
  return [...seen].sort();
}

export function toCsv(results: SearchResult[]): string {
  const cols: (keyof SearchResult)[] = ['project_id', 'path', 'filename', 'ref', 'startline'];
  const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = results.map(r => cols.map(c => esc(r[c])).join(','));
  return [cols.join(','), ...rows].join('\n');
}
