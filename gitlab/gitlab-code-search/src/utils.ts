import type { FilterState, SearchResult } from './types.js';

export function resolveApiEndpoint(pathname: string, projectId: number | null): string {
  if (/^\/-\/search/.test(pathname)) return '/api/v4/search';

  const groupMatch = pathname.match(/^\/groups\/(.+?)\/-\/search/);
  if (groupMatch) return `/api/v4/groups/${groupMatch[1]}/search`;

  if (projectId !== null) return `/api/v4/projects/${projectId}/search`;

  return '/api/v4/search';
}

export function buildQuery(mainQuery: string, filters: Partial<FilterState>): string {
  const parts: string[] = [mainQuery.trim()];
  for (const ext of (filters.extensions ?? [])) {
    if (ext) parts.push(`extension:${ext}`);
  }
  if (filters.filename) parts.push(`filename:${filters.filename}`);
  if (filters.path) parts.push(`path:${filters.path}`);
  return parts.filter(Boolean).join(' ');
}

export function extractRepoPaths(results: SearchResult[]): string[] { return []; }
export function toCsv(results: SearchResult[]): string { return ''; }
