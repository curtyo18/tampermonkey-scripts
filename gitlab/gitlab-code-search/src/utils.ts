import type { FilterState, SearchResult } from './types.js';

export function resolveApiEndpoint(pathname: string, projectId: number | null): string { return ''; }
export function buildQuery(mainQuery: string, filters: Partial<FilterState>): string { return ''; }
export function extractRepoPaths(results: SearchResult[]): string[] { return []; }
export function toCsv(results: SearchResult[]): string { return ''; }
