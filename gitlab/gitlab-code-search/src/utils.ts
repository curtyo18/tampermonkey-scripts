import type { FilterState, SearchResult } from './types.js';

export function resolveApiEndpoint(pathname: string, projectId: number | null): string {
  if (/^\/-\/search/.test(pathname)) return '/api/v4/search';

  // .+? intentionally matches slashes — GitLab nested groups use /groups/parent/child/-/search
  const groupMatch = pathname.match(/^\/groups\/(.+?)\/-\/search/);
  if (groupMatch) return `/api/v4/groups/${groupMatch[1]}/search`;

  if (projectId !== null) return `/api/v4/projects/${projectId}/search`;

  return '/api/v4/search';
}

export function buildQuery(mainQuery: string, filters: Partial<FilterState>): string {
  // GitLab's filter syntax (extension:X, filename:X, path:X) does not support quoting,
  // so filter values with spaces will behave unexpectedly — UI controls should prevent this.
  const parts: string[] = [mainQuery.trim()];
  for (const ext of (filters.extensions ?? [])) {
    if (ext) parts.push(`extension:${ext}`);
  }
  if (filters.filename) parts.push(`filename:${filters.filename}`);
  if (filters.path) parts.push(`path:${filters.path}`);
  return parts.filter(Boolean).join(' ');
}

export function extractRepoPaths(results: SearchResult[]): string[] {
  const seen = new Set<string>();
  for (const r of results) {
    const segs = (r.path ?? '').split('/');
    if (segs.length >= 2) seen.add(`${segs[0]}/${segs[1]}`);
  }
  return [...seen].sort();
}

export function toCsv(results: SearchResult[]): string {
  const cols: (keyof SearchResult)[] = ['project_id', 'path', 'filename', 'ref', 'startline'];
  const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = results.map(r => cols.map(c => esc(r[c])).join(','));
  return [cols.join(','), ...rows].join('\n');
}
